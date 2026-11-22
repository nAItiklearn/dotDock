//! Taking screenshots: a monitor, a window, or a rectangle, saved as PNG in the user's Pictures\Screenshots.
//!
//! Capture uses GDI (`BitBlt` from the screen, `PrintWindow` for one window). Decision D-021 records why not
//! `Windows.Graphics.Capture`: for a desktop app without package identity it draws a yellow capture border around
//! what is being captured, which would show in every screenshot of the dock's own tile, while GDI is instant,
//! needs no consent prompt, and leaves out protected video by design. Coordinates are physical pixels: the thread
//! is made per-monitor DPI aware for the duration of the call, so a 150 % display captures 1.5 x the points.

use crate::clock::{file_stamp, now_ms};
use crate::image;
use crate::protocol::{CaptureMode, PixelRect};
use std::fs;
use std::path::{Path, PathBuf};
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, GetMonitorInfoW,
    MonitorFromPoint, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, HDC,
    HGDIOBJ, MONITORINFO, MONITOR_DEFAULTTONEAREST, SRCCOPY,
};
use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
use windows::Win32::UI::HiDpi::{SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetSystemMetrics, GetWindowRect, IsIconic, IsWindow, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
    SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
};

/// `PW_RENDERFULLCONTENT`: lets `PrintWindow` capture windows drawn by DirectComposition or the GPU.
const PW_RENDERFULLCONTENT: u32 = 2;
/// A capture larger than this (three 4K monitors is about 25 million) is refused rather than allocated.
const MAX_PIXELS: u64 = 64_000_000;

/// Switches this thread to physical pixels and switches back when dropped.
struct PhysicalPixels(windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT);

impl PhysicalPixels {
    fn begin() -> Self {
        // SAFETY: only changes the calling thread's DPI mode, restored in Drop.
        Self(unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) })
    }
}

impl Drop for PhysicalPixels {
    fn drop(&mut self) {
        // SAFETY: restores the context saved in `begin`.
        unsafe { SetThreadDpiAwarenessContext(self.0) };
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Area {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

impl Area {
    fn from_rect(r: RECT) -> Self {
        Self { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top }
    }
}

/// The part of `wanted` that lies on the virtual desktop; None when nothing does.
fn clamp_to_desktop(wanted: Area, desktop: Area) -> Option<Area> {
    let left = wanted.x.max(desktop.x);
    let top = wanted.y.max(desktop.y);
    let right = (wanted.x + wanted.w).min(desktop.x + desktop.w);
    let bottom = (wanted.y + wanted.h).min(desktop.y + desktop.h);
    (right > left && bottom > top).then_some(Area { x: left, y: top, w: right - left, h: bottom - top })
}

fn desktop_area() -> Area {
    // SAFETY: plain metric queries.
    unsafe {
        Area {
            x: GetSystemMetrics(SM_XVIRTUALSCREEN),
            y: GetSystemMetrics(SM_YVIRTUALSCREEN),
            w: GetSystemMetrics(SM_CXVIRTUALSCREEN),
            h: GetSystemMetrics(SM_CYVIRTUALSCREEN),
        }
    }
}

fn monitor_under_cursor() -> Result<Area, String> {
    let mut point = POINT::default();
    // SAFETY: writes the point; the monitor info struct is sized as the API requires.
    unsafe {
        GetCursorPos(&mut point).map_err(|e| format!("could not read the cursor: {e}"))?;
        let monitor = MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return Err("Windows would not describe the monitor".to_owned());
        }
        Ok(Area::from_rect(info.rcMonitor))
    }
}

/// Runs `paint` against a memory bitmap of the given size and returns its pixels as top-down BGRA.
fn render(w: i32, h: i32, paint: impl FnOnce(HDC) -> bool) -> Result<Vec<u8>, String> {
    if w <= 0 || h <= 0 || (w as u64) * (h as u64) > MAX_PIXELS {
        return Err("That area is too large to capture".to_owned());
    }
    // SAFETY: every GDI object created here is released before returning, in reverse order of creation.
    unsafe {
        let screen = GetDC(None);
        let memory = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, w, h);
        let previous = SelectObject(memory, HGDIOBJ(bitmap.0));
        let painted = paint(memory);
        SelectObject(memory, previous);
        let mut pixels = vec![0u8; w as usize * h as usize * 4];
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let rows = GetDIBits(memory, bitmap, 0, h as u32, Some(pixels.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(memory);
        ReleaseDC(None, screen);
        if !painted || rows == 0 {
            return Err("Windows would not draw that area".to_owned());
        }
        Ok(pixels)
    }
}

fn grab_screen(area: Area) -> Result<Vec<u8>, String> {
    render(area.w, area.h, |memory| {
        // SAFETY: copies from the screen device context into the memory context for the whole area.
        unsafe {
            let screen = GetDC(None);
            let ok = BitBlt(memory, 0, 0, area.w, area.h, Some(screen), area.x, area.y, SRCCOPY | CAPTUREBLT).is_ok();
            ReleaseDC(None, screen);
            ok
        }
    })
}

/// Pixels of a square of the screen, as top-down BGRA, for the colour picker's magnifier. Physical coordinates;
/// the caller's thread must be per-monitor DPI aware.
pub(crate) fn grab_square(x: i32, y: i32, side: i32) -> Result<Vec<u8>, String> {
    grab_screen(Area { x, y, w: side, h: side })
}

/// The virtual desktop in physical pixels: `(x, y, width, height)`.
pub(crate) fn desktop_bounds() -> (i32, i32, i32, i32) {
    let d = desktop_area();
    (d.x, d.y, d.w, d.h)
}

/// The window's pixels, taken from the window itself so another window on top of it does not show.
fn grab_window(hwnd: HWND) -> Result<(Vec<u8>, Area), String> {
    // SAFETY: plain queries on a window handle that was checked with IsWindow.
    unsafe {
        if !IsWindow(Some(hwnd)).as_bool() {
            return Err("That window is gone".to_owned());
        }
        if IsIconic(hwnd).as_bool() {
            return Err("That window is minimised".to_owned());
        }
        let mut outer = RECT::default();
        GetWindowRect(hwnd, &mut outer).map_err(|e| format!("could not measure the window: {e}"))?;
        let mut frame = RECT::default();
        let visible = if DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            (&mut frame as *mut RECT).cast(),
            std::mem::size_of::<RECT>() as u32,
        )
        .is_ok()
        {
            Area::from_rect(frame)
        } else {
            Area::from_rect(outer)
        };
        let full = Area::from_rect(outer);
        let pixels = render(full.w, full.h, |memory| {
            PrintWindow(hwnd, memory, PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT)).as_bool()
        })?;
        // Crop away the invisible resize border that Windows adds around a framed window.
        let crop = Area { x: visible.x - full.x, y: visible.y - full.y, w: visible.w, h: visible.h };
        let crop = clamp_to_desktop(crop, Area { x: 0, y: 0, w: full.w, h: full.h })
            .ok_or("The window has no visible area")?;
        let mut out = Vec::with_capacity(crop.w as usize * crop.h as usize * 4);
        for row in crop.y..crop.y + crop.h {
            let start = (row as usize * full.w as usize + crop.x as usize) * 4;
            out.extend_from_slice(&pixels[start..start + crop.w as usize * 4]);
        }
        Ok((out, crop))
    }
}

/// `Screenshot 2026-11-20 143105.png`, or with ` (2)`, ` (3)`... if that name is taken.
fn free_name(folder: &Path, stamp: &str) -> PathBuf {
    let first = folder.join(format!("Screenshot {stamp}.png"));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| folder.join(format!("Screenshot {stamp} ({n}).png")))
        .find(|p| !p.exists())
        .expect("an unused name exists")
}

/// Takes a screenshot and saves it in `folder`. Returns the file.
pub fn capture(
    folder: &Path,
    mode: CaptureMode,
    hwnd: Option<&str>,
    rect: Option<PixelRect>,
) -> Result<PathBuf, String> {
    let _physical = PhysicalPixels::begin();
    let (mut pixels, area) = match mode {
        CaptureMode::Screen => {
            let area = monitor_under_cursor()?;
            (grab_screen(area)?, area)
        }
        CaptureMode::Region => {
            let r = rect.ok_or("No region was given")?;
            let wanted = Area { x: r.x, y: r.y, w: r.w, h: r.h };
            let area = clamp_to_desktop(wanted, desktop_area()).ok_or("That region is outside the screen")?;
            (grab_screen(area)?, area)
        }
        CaptureMode::Window => {
            let raw: isize = hwnd.and_then(|h| h.parse().ok()).ok_or("No window was given")?;
            grab_window(HWND(raw as *mut _))?
        }
    };
    image::bgra_to_rgba(&mut pixels);
    let png = image::encode_png(&pixels, area.w as u32, area.h as u32)?;
    fs::create_dir_all(folder).map_err(|e| format!("could not create {}: {e}", folder.display()))?;
    let path = free_name(folder, &file_stamp(now_ms()));
    fs::write(&path, png).map_err(|e| format!("could not save the screenshot: {e}"))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DESKTOP: Area = Area { x: -1920, y: 0, w: 3840, h: 1080 };

    #[test]
    fn regions_are_clipped_to_the_desktop() {
        let inside = Area { x: 10, y: 10, w: 100, h: 100 };
        assert_eq!(clamp_to_desktop(inside, DESKTOP), Some(inside));
        let hanging_off = Area { x: -2000, y: -50, w: 200, h: 200 };
        assert_eq!(clamp_to_desktop(hanging_off, DESKTOP), Some(Area { x: -1920, y: 0, w: 120, h: 150 }));
        assert_eq!(clamp_to_desktop(Area { x: 5000, y: 0, w: 10, h: 10 }, DESKTOP), None);
        assert_eq!(clamp_to_desktop(Area { x: 0, y: 0, w: 0, h: 10 }, DESKTOP), None);
    }

    #[test]
    fn a_taken_name_gets_a_number() {
        let dir = tempfile::tempdir().unwrap();
        let first = free_name(dir.path(), "2026-01-01 000000");
        fs::write(&first, b"x").unwrap();
        let second = free_name(dir.path(), "2026-01-01 000000");
        assert_ne!(first, second);
        assert!(second.to_string_lossy().ends_with("(2).png"));
    }

    #[test]
    fn a_region_capture_saves_a_real_png_of_the_screen() {
        let dir = tempfile::tempdir().unwrap();
        let path = capture(dir.path(), CaptureMode::Region, None, Some(PixelRect { x: 0, y: 0, w: 64, h: 48 }))
            .expect("capture");
        let mut reader =
            png::Decoder::new(std::io::BufReader::new(fs::File::open(&path).unwrap())).read_info().unwrap();
        let info = reader.info();
        assert_eq!((info.width, info.height), (64, 48));
        let mut buf = vec![0; reader.output_buffer_size().unwrap()];
        reader.next_frame(&mut buf).unwrap();
        assert!(buf.as_chunks::<4>().0.iter().all(|p| p[3] == 255), "screenshots are opaque");
    }

    #[test]
    fn missing_arguments_are_reported() {
        let dir = tempfile::tempdir().unwrap();
        assert!(capture(dir.path(), CaptureMode::Region, None, None).is_err());
        assert!(capture(dir.path(), CaptureMode::Window, None, None).is_err());
        assert!(capture(dir.path(), CaptureMode::Window, Some("not a number"), None).is_err());
    }
}
