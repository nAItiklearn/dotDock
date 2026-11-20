//! The glass behind the dock: Windows' own acrylic, drawn behind the shapes the dock reports.
//!
//! CSS `backdrop-filter` cannot blur the desktop behind a transparent WebView2 window, and one window-wide
//! backdrop would frost the whole monitor-sized sheet. So the blur lives in a plate of its own: a plain window
//! with the system backdrop, the same size as the dock window and just below it in z-order, cut to the union of
//! the pill and the popovers with a window region. The dock window draws on top, so its borders and shadows
//! cover the plate's hard edge.
//!
//! The material is the system backdrop (`DWMWA_SYSTEMBACKDROP_TYPE`, acrylic) on Windows 11 22H2 and later and
//! the acrylic accent policy before that. Every call belongs to the thread that created the plate (the host's
//! message loop thread).

use crate::placement::PxRect;
use serde::Deserialize;
use std::ffi::c_void;
use std::io;
use windows::core::{w, BOOL, PCSTR, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DwmExtendFrameIntoClientArea, DwmSetWindowAttribute, DWMSBT_TRANSIENTWINDOW, DWMWA_BORDER_COLOR,
    DWMWA_SYSTEMBACKDROP_TYPE, DWMWA_USE_IMMERSIVE_DARK_MODE, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
    DWM_WINDOW_CORNER_PREFERENCE,
};
use windows::Win32::Graphics::Gdi::{
    CombineRgn, CreateRectRgn, CreateRoundRectRgn, DeleteObject, GetStockObject, SetWindowRgn, BLACK_BRUSH, HBRUSH,
    HGDIOBJ, HRGN, RGN_OR,
};
use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
use windows::Win32::UI::Controls::MARGINS;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, RegisterClassW, SetWindowPos, ShowWindow, HTTRANSPARENT,
    MA_NOACTIVATE, SWP_NOACTIVATE, SW_HIDE, SW_SHOWNOACTIVATE, WINDOW_EX_STYLE, WM_MOUSEACTIVATE, WM_NCHITTEST,
    WNDCLASSW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_POPUP,
};

const CLASS_NAME: PCWSTR = w!("DotDockGlassPlate");
/// `DWMWA_COLOR_NONE`: no border drawn around the window.
const NO_BORDER: u32 = 0xFFFF_FFFE;
/// `WCA_ACCENT_POLICY` and `ACCENT_ENABLE_ACRYLICBLURBEHIND`, the acrylic of Windows 10 1803 and later.
const WCA_ACCENT_POLICY: u32 = 19;
const ACCENT_ENABLE_ACRYLIC: u32 = 4;
/// Tint of the accent-policy acrylic, `0xAABBGGRR`: near black or near white, mostly transparent.
const TINT_DARK: u32 = 0x66_16_14_12;
const TINT_LIGHT: u32 = 0x66_F4_F3_F2;

/// One piece of glass: a rounded rectangle in CSS px relative to the dock window.
#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
pub struct Shape {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    /// Corner radius; half the shorter side makes a pill.
    pub radius: f64,
}

/// What draws the blur.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Material {
    /// `DWMWA_SYSTEMBACKDROP_TYPE` acrylic (Windows 11 22H2 and later).
    SystemBackdrop,
    /// The acrylic accent policy of `SetWindowCompositionAttribute` (Windows 10 and early Windows 11).
    AccentPolicy,
}

#[repr(C)]
struct AccentPolicy {
    state: u32,
    flags: u32,
    gradient_colour: u32,
    animation_id: u32,
}

#[repr(C)]
struct CompositionAttribute {
    attribute: u32,
    data: *mut c_void,
    size: usize,
}

type SetCompositionAttribute = unsafe extern "system" fn(HWND, *mut CompositionAttribute) -> BOOL;

/// The glass plate. Dropping it destroys the window.
pub struct Glass {
    plate: HWND,
    material: Material,
    /// The tone applied to the material so far; `None` until the first `show`.
    dark: Option<bool>,
}

impl Glass {
    /// Creates the plate hidden. It shows once there are shapes to draw.
    pub fn new() -> io::Result<Glass> {
        // SAFETY: standard class and window creation on this thread; the window is destroyed in `Drop`.
        let plate = unsafe {
            let instance = GetModuleHandleW(None).map_err(io::Error::other)?;
            let class = WNDCLASSW {
                lpfnWndProc: Some(plate_proc),
                hInstance: instance.into(),
                lpszClassName: CLASS_NAME,
                // Black is transparent glass once the frame is extended over the client area.
                hbrBackground: HBRUSH(GetStockObject(BLACK_BRUSH).0),
                ..Default::default()
            };
            // A second plate in the same process finds the class registered, which is fine.
            RegisterClassW(&class);
            CreateWindowExW(
                WINDOW_EX_STYLE(WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0),
                CLASS_NAME,
                w!("dotDock glass"),
                WS_POPUP,
                0,
                0,
                0,
                0,
                None,
                None,
                Some(instance.into()),
                None,
            )
            .map_err(io::Error::other)?
        };
        let mut glass = Glass { plate, material: Material::SystemBackdrop, dark: None };
        glass.material = glass.choose_material();
        Ok(glass)
    }

    /// The material in use, for the log.
    pub fn material(&self) -> Material {
        self.material
    }

    /// The plate's window handle, so the dock window can be ordered above it.
    pub fn hwnd(&self) -> isize {
        self.plate.0 as isize
    }

    /// Windows 11 22H2 accepts the system backdrop; anything older refuses the attribute and gets the accent policy.
    fn choose_material(&self) -> Material {
        let frame = MARGINS { cxLeftWidth: -1, cxRightWidth: -1, cyTopHeight: -1, cyBottomHeight: -1 };
        let backdrop = DWMSBT_TRANSIENTWINDOW;
        let no_round = DWMWCP_DONOTROUND;
        // SAFETY: DWM attribute calls on our own window with values of the documented size.
        let accepted = unsafe {
            let _ = DwmSetWindowAttribute(
                self.plate,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                std::ptr::from_ref::<DWM_WINDOW_CORNER_PREFERENCE>(&no_round).cast(),
                size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
            );
            let _ = DwmSetWindowAttribute(
                self.plate,
                DWMWA_BORDER_COLOR,
                std::ptr::from_ref(&NO_BORDER).cast(),
                size_of::<u32>() as u32,
            );
            let _ = DwmExtendFrameIntoClientArea(self.plate, &frame);
            DwmSetWindowAttribute(
                self.plate,
                DWMWA_SYSTEMBACKDROP_TYPE,
                std::ptr::from_ref(&backdrop).cast(),
                size_of_val(&backdrop) as u32,
            )
            .is_ok()
        };
        if accepted {
            Material::SystemBackdrop
        } else {
            Material::AccentPolicy
        }
    }

    /// Switches between the dark and the light tint of the material.
    fn apply_tone(&mut self, dark: bool) {
        self.dark = Some(dark);
        match self.material {
            Material::SystemBackdrop => {
                let flag = BOOL::from(dark);
                // SAFETY: a BOOL attribute on our own window.
                unsafe {
                    let _ = DwmSetWindowAttribute(
                        self.plate,
                        DWMWA_USE_IMMERSIVE_DARK_MODE,
                        std::ptr::from_ref(&flag).cast(),
                        size_of::<BOOL>() as u32,
                    );
                }
            }
            Material::AccentPolicy => set_accent_policy(self.plate, if dark { TINT_DARK } else { TINT_LIGHT }),
        }
    }

    /// Puts the plate over `rect` (the dock window's rectangle) and directly behind `above`, the dock window.
    pub fn follow(&self, rect: PxRect, above: isize) {
        // SAFETY: positions our own window below the dock window without activating it.
        unsafe {
            let _ = SetWindowPos(
                self.plate,
                Some(HWND(above as *mut _)),
                rect.left,
                rect.top,
                rect.width(),
                rect.height(),
                SWP_NOACTIVATE,
            );
        }
    }

    /// Draws glass behind `shapes` (CSS px, at `scale`). An empty list hides the plate.
    pub fn show(&mut self, shapes: &[Shape], scale: f64, dark: bool) -> io::Result<()> {
        if shapes.is_empty() {
            self.hide();
            return Ok(());
        }
        if self.dark != Some(dark) {
            self.apply_tone(dark);
        }
        let region = region_of(shapes, scale)?;
        // SAFETY: on success the system owns the region; on failure it is ours to delete.
        unsafe {
            if SetWindowRgn(self.plate, Some(region), true) == 0 {
                let _ = DeleteObject(HGDIOBJ(region.0));
                return Err(io::Error::other("the glass plate refused its shape"));
            }
            let _ = ShowWindow(self.plate, SW_SHOWNOACTIVATE);
        }
        Ok(())
    }

    pub fn hide(&self) {
        // SAFETY: hides our own window.
        unsafe {
            let _ = ShowWindow(self.plate, SW_HIDE);
        }
    }
}

impl Drop for Glass {
    fn drop(&mut self) {
        // SAFETY: destroys the window this value created.
        unsafe {
            let _ = DestroyWindow(self.plate);
        }
    }
}

/// The union of the shapes as a window region, in physical px.
fn region_of(shapes: &[Shape], scale: f64) -> io::Result<HRGN> {
    // SAFETY: GDI region calls; every temporary region is deleted, the result is returned to the caller.
    unsafe {
        let union = CreateRectRgn(0, 0, 0, 0);
        for shape in shapes {
            let (left, top) = ((shape.x * scale).round() as i32, (shape.y * scale).round() as i32);
            let (right, bottom) = (((shape.x + shape.w) * scale).round() as i32, ((shape.y + shape.h) * scale).round() as i32);
            let diameter = (2.0 * shape.radius * scale).round() as i32;
            let piece = CreateRoundRectRgn(left, top, right + 1, bottom + 1, diameter, diameter);
            CombineRgn(Some(union), Some(union), Some(piece), RGN_OR);
            let _ = DeleteObject(HGDIOBJ(piece.0));
        }
        Ok(union)
    }
}

fn set_accent_policy(hwnd: HWND, tint: u32) {
    // SAFETY: `SetWindowCompositionAttribute` is not in the SDK headers; it is looked up by name and called with the
    // layout the system expects. A missing export just means no blur.
    unsafe {
        let Ok(user32) = GetModuleHandleW(w!("user32.dll")) else { return };
        let Some(entry) = GetProcAddress(user32, PCSTR(c"SetWindowCompositionAttribute".as_ptr().cast())) else {
            return;
        };
        let set: SetCompositionAttribute = std::mem::transmute(entry);
        let mut policy = AccentPolicy { state: ACCENT_ENABLE_ACRYLIC, flags: 0, gradient_colour: tint, animation_id: 0 };
        let mut attribute = CompositionAttribute {
            attribute: WCA_ACCENT_POLICY,
            data: std::ptr::from_mut(&mut policy).cast(),
            size: size_of::<AccentPolicy>(),
        };
        let _ = set(hwnd, &mut attribute);
    }
}

unsafe extern "system" fn plate_proc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match message {
        // The plate never takes a click or the focus: the dock window above it does.
        WM_NCHITTEST => LRESULT(HTTRANSPARENT as isize),
        WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
        // SAFETY: default handling for everything else.
        _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_accent_policy_has_the_layout_the_system_expects() {
        assert_eq!(size_of::<AccentPolicy>(), 16);
        // A 4-byte attribute id padded to a pointer, then the data pointer and its size.
        assert_eq!(size_of::<CompositionAttribute>(), 3 * size_of::<usize>());
    }

    #[test]
    fn shapes_read_from_the_ui() {
        let shape: Shape = serde_json::from_str(r#"{"x":10,"y":20,"w":300,"h":60,"radius":30}"#).unwrap();
        assert_eq!(shape, Shape { x: 10.0, y: 20.0, w: 300.0, h: 60.0, radius: 30.0 });
    }
}
