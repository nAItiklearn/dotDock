//! Getting pixels from the shell: `IShellItemImageFactory` for any item, the package's own logo files when
//! the shell's answer for a Store app is small.

use super::image::{decode_png, Rgba};
use super::{assets, IconSource, ICON_SIZE};
use crate::catalogue::manifest;
use crate::com::{pcwstr, wide};
use std::io;
use windows::core::Interface;
use windows::Win32::Foundation::SIZE;
use windows::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    DIB_RGB_COLORS, HGDIOBJ,
};
use windows::Win32::UI::Shell::{IShellItem, IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_ICONONLY};

const BITS_PER_PIXEL: u16 = 32;
const BYTES_PER_PIXEL: usize = 4;
const PLANES: u16 = 1;

/// Tries each source in turn and returns the first real picture; a blank bitmap does not count.
/// Needs COM on the calling thread.
pub fn extract_first(sources: &[IconSource]) -> io::Result<Rgba> {
    let mut last_error = io::Error::other("no icon source");
    for source in sources {
        match extract(source) {
            Ok(image) if image.is_blank() => {}
            Ok(image) => return Ok(image),
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

/// Extracts the best icon for `source`.
fn extract(source: &IconSource) -> io::Result<Rgba> {
    match source {
        IconSource::File(path) => from_factory(&path.to_string_lossy()),
        IconSource::AppsFolder { id, package_dir } => {
            let from_shell = from_factory(&format!("shell:AppsFolder\\{id}")).ok().filter(|i| !i.is_blank());
            let big_enough = from_shell.as_ref().is_some_and(|i| i.short_edge() >= ICON_SIZE);
            if big_enough {
                return from_shell.ok_or_else(|| io::Error::other("unreachable"));
            }
            let from_package = package_dir.as_deref().and_then(|dir| package_logo(dir, id));
            match (from_shell, from_package) {
                (Some(a), Some(b)) => Ok(if b.short_edge() > a.short_edge() { b } else { a }),
                (Some(only), None) | (None, Some(only)) => Ok(only),
                (None, None) => Err(io::Error::other(format!("no icon for {id}"))),
            }
        }
    }
}

/// The biggest logo file the package ships for the application named in `aumid` (`family!app`).
fn package_logo(dir: &std::path::Path, aumid: &str) -> Option<Rgba> {
    let xml = std::fs::read_to_string(dir.join("AppxManifest.xml")).ok()?;
    let manifest = manifest::parse(&xml);
    let app = manifest.application(aumid.rsplit('!').next().unwrap_or(aumid))?;
    let relative = app.square44.as_deref().or(app.square150.as_deref()).or(app.logo.as_deref())?;
    let file = assets::best_logo(dir, relative)?;
    decode_png(&std::fs::read(file).ok()?).ok().filter(|i| !i.is_blank())
}

fn from_factory(parsing_name: &str) -> io::Result<Rgba> {
    let name = wide(parsing_name);
    // SAFETY: COM calls on a thread with COM initialised; the bitmap handle is deleted on every path.
    unsafe {
        let item: IShellItem = SHCreateItemFromParsingName(pcwstr(&name), None).map_err(io::Error::other)?;
        let factory: IShellItemImageFactory = item.cast().map_err(io::Error::other)?;
        let size = SIZE { cx: ICON_SIZE as i32, cy: ICON_SIZE as i32 };
        let bitmap = factory.GetImage(size, SIIGBF_ICONONLY).map_err(io::Error::other)?;
        let image = read_bitmap(bitmap);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        // A 32 px icon asked for at 256 px comes back as a dot in the middle of the canvas; fill the canvas.
        image.map(|i| i.enlarge_small_native().unwrap_or(i))
    }
}

/// Reads a 32-bit bitmap into RGBA.
///
/// # Safety
/// `bitmap` must be a live bitmap handle.
unsafe fn read_bitmap(bitmap: windows::Win32::Graphics::Gdi::HBITMAP) -> io::Result<Rgba> {
    // SAFETY: `BITMAP` is plain data; GetDIBits fills a buffer we sized from the bitmap's own dimensions.
    unsafe {
        let mut info = BITMAP::default();
        let copied =
            GetObjectW(HGDIOBJ(bitmap.0), size_of::<BITMAP>() as i32, Some(std::ptr::from_mut(&mut info).cast()));
        if copied == 0 || info.bmWidth <= 0 || info.bmHeight <= 0 {
            return Err(io::Error::other("the shell returned no bitmap"));
        }
        let (width, height) = (info.bmWidth as u32, info.bmHeight as u32);
        let mut header = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: info.bmWidth,
                // Negative height asks for rows top to bottom.
                biHeight: -info.bmHeight,
                biPlanes: PLANES,
                biBitCount: BITS_PER_PIXEL,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bytes = vec![0u8; width as usize * height as usize * BYTES_PER_PIXEL];
        let hdc = GetDC(None);
        let rows = GetDIBits(hdc, bitmap, 0, height, Some(bytes.as_mut_ptr().cast()), &mut header, DIB_RGB_COLORS);
        ReleaseDC(None, hdc);
        if rows == 0 {
            return Err(io::Error::other("could not read the bitmap bits"));
        }
        // A bitmap without an alpha channel comes back with every alpha zero; it is opaque then.
        let has_alpha = bytes.as_chunks::<BYTES_PER_PIXEL>().0.iter().any(|p| p[3] != 0);
        if !has_alpha {
            for px in bytes.as_chunks_mut::<BYTES_PER_PIXEL>().0.iter_mut() {
                px[3] = u8::MAX;
            }
        }
        Rgba::from_bgra(width, height, &bytes, PREMULTIPLIED).ok_or_else(|| io::Error::other("empty bitmap"))
    }
}

/// Whether the factory's bitmaps carry premultiplied alpha. Decided by looking at the contact sheet of this
/// machine's icons on light and dark backgrounds (`docs/spikes/DOCK_D1.md`).
const PREMULTIPLIED: bool = true;
