//! Helpers the window-based examples share: make a plain window, run its messages for a while, read a rect back
//! from the screen. Not part of the library; the examples are probes, not product code.
#![allow(dead_code)]

use dotdock_dock::icons::Rgba;
use std::time::{Duration, Instant};
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{BeginPaint, HBRUSH};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, CreateSolidBrush, DeleteDC, DeleteObject, EndPaint, FillRect,
    GetDC, GetDIBits, GetStockObject, ReleaseDC, SelectObject, BLACK_BRUSH, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS,
    HGDIOBJ, PAINTSTRUCT, SRCCOPY,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, PeekMessageW, RegisterClassW, ShowWindow,
    TranslateMessage, MSG, PM_REMOVE, SW_SHOWNOACTIVATE, WINDOW_EX_STYLE, WINDOW_STYLE, WM_PAINT, WNDCLASSW,
};

/// Colour bars painted into the source window so a thumbnail of it is recognisable in a screenshot.
const BARS: [u32; 6] = [0x0000_00ff, 0x0000_a5ff, 0x0000_ffff, 0x0000_c000, 0x00ff_0000, 0x00a0_0080];

unsafe extern "system" fn paint_proc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if message == WM_PAINT {
        // SAFETY: standard paint cycle on our own window.
        unsafe {
            let mut ps = PAINTSTRUCT::default();
            let hdc = BeginPaint(hwnd, &mut ps);
            let mut client = RECT::default();
            let _ = windows::Win32::UI::WindowsAndMessaging::GetClientRect(hwnd, &mut client);
            let bar = (client.right - client.left) / BARS.len() as i32;
            for (i, colour) in BARS.iter().enumerate() {
                let brush = CreateSolidBrush(COLORREF(*colour));
                let r = RECT { left: i as i32 * bar, top: 0, right: (i as i32 + 1) * bar, bottom: client.bottom };
                FillRect(hdc, &r, brush);
                let _ = DeleteObject(HGDIOBJ(brush.0));
            }
            let _ = EndPaint(hwnd, &ps);
        }
        return LRESULT(0);
    }
    // SAFETY: default handling.
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

/// Makes the process DPI aware so window and capture coordinates are physical pixels, as in the real dock.
pub fn dpi_aware() {
    // SAFETY: sets the awareness of this process once, before any window exists.
    unsafe {
        let _ = windows::Win32::UI::HiDpi::SetProcessDpiAwarenessContext(
            windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        );
    }
}

unsafe extern "system" fn plain_proc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    // SAFETY: default handling.
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

/// What a probe window looks like.
#[derive(Clone, Copy)]
pub enum Look {
    /// Vertical colour bars, so a thumbnail of it is recognisable.
    Bars,
    /// One flat dark colour.
    Dark,
    /// Black, which DWM treats as see-through once blur-behind is on: the stand-in for the transparent dock window.
    Clear,
}

/// Background of `Look::Dark` windows (BGR), unlike any of the bars.
pub const DARK: u32 = 0x0030_2018;

/// A visible, non-activating window of the given look at `rect` (screen px).
pub fn probe_window(look: Look, title: PCWSTR, rect: RECT, style: WINDOW_STYLE, ex_style: WINDOW_EX_STYLE) -> HWND {
    // SAFETY: class registration and window creation on the calling thread.
    unsafe {
        let instance = GetModuleHandleW(None).unwrap_or_default();
        let (name, procedure, background) = match look {
            Look::Bars => (w!("DotDockProbeBars"), paint_proc as _, HBRUSH::default()),
            Look::Dark => (w!("DotDockProbeDark"), plain_proc as _, CreateSolidBrush(COLORREF(DARK))),
            Look::Clear => (w!("DotDockProbeClear"), plain_proc as _, HBRUSH(GetStockObject(BLACK_BRUSH).0)),
        };
        let class = WNDCLASSW {
            lpfnWndProc: Some(procedure),
            hInstance: instance.into(),
            lpszClassName: name,
            hbrBackground: background,
            ..Default::default()
        };
        RegisterClassW(&class);
        let hwnd = CreateWindowExW(
            ex_style,
            name,
            title,
            style,
            rect.left,
            rect.top,
            rect.right - rect.left,
            rect.bottom - rect.top,
            None,
            None,
            Some(instance.into()),
            None,
        )
        .expect("create window");
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        hwnd
    }
}

pub fn destroy(hwnd: HWND) {
    // SAFETY: destroys a window this thread created.
    unsafe {
        let _ = DestroyWindow(hwnd);
    }
}

/// Runs this thread's window messages for `duration`.
pub fn pump(duration: Duration) {
    let end = Instant::now() + duration;
    let mut message = MSG::default();
    while Instant::now() < end {
        // SAFETY: standard non-blocking message pump.
        unsafe {
            while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// What is on the screen inside `rect`, composed (DWM thumbnails included), as RGBA.
pub fn capture(rect: RECT) -> Rgba {
    let (w, h) = (rect.right - rect.left, rect.bottom - rect.top);
    // SAFETY: GDI capture of the screen into a bitmap we create and delete.
    unsafe {
        let screen = GetDC(None);
        let memory = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, w, h);
        let old = SelectObject(memory, HGDIOBJ(bitmap.0));
        let _ = BitBlt(memory, 0, 0, w, h, Some(screen), rect.left, rect.top, SRCCOPY | CAPTUREBLT);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bytes = vec![0u8; (w * h * 4) as usize];
        GetDIBits(memory, bitmap, 0, h as u32, Some(bytes.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
        SelectObject(memory, old);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(memory);
        ReleaseDC(None, screen);
        for px in bytes.as_chunks_mut::<4>().0.iter_mut() {
            px[3] = u8::MAX;
        }
        Rgba::from_bgra(w as u32, h as u32, &bytes, false).expect("capture")
    }
}

/// The pixel at (x, y) of `image` as (r, g, b).
pub fn pixel(image: &Rgba, x: u32, y: u32) -> (u8, u8, u8) {
    let i = ((y * image.width + x) * 4) as usize;
    (image.pixels[i], image.pixels[i + 1], image.pixels[i + 2])
}
