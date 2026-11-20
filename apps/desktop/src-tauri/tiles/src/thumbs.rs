//! Thumbnails and icons of files, from the same Windows shell source Explorer uses (so images show a preview,
//! documents and programs show their icon), returned as PNG data URLs.

use crate::com::wide;
use crate::emit::lock;
use crate::image;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use windows::core::PCWSTR;
use windows::Win32::Foundation::SIZE;
use windows::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    HGDIOBJ,
};
use windows::Win32::UI::Shell::{IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_RESIZETOFIT};

/// Thumbnails kept in memory; the cache is emptied when it grows past this.
const CACHE_LIMIT: usize = 96;
/// Sizes asked for are limited so a bad request cannot allocate a huge bitmap.
const MIN_SIDE: u32 = 16;
const MAX_SIDE: u32 = 512;

#[derive(Default)]
pub struct Thumbs {
    cache: Mutex<HashMap<(String, u32, i64), String>>,
}

impl Thumbs {
    /// A `data:image/png` URL of `path` at roughly `size` px. `modified_ms` keys the cache so an edited file is
    /// re-rendered.
    pub fn get(&self, path: &Path, size: u32, modified_ms: i64) -> Result<String, String> {
        let size = size.clamp(MIN_SIDE, MAX_SIDE);
        let key = (path.to_string_lossy().to_lowercase(), size, modified_ms);
        if let Some(hit) = lock(&self.cache).get(&key) {
            return Ok(hit.clone());
        }
        let url = render(path, size)?;
        let mut cache = lock(&self.cache);
        if cache.len() >= CACHE_LIMIT {
            cache.clear();
        }
        cache.insert(key, url.clone());
        Ok(url)
    }
}

/// Reverts premultiplied BGRA from GDI into straight RGBA.
fn bgra_premultiplied_to_rgba(pixels: &mut [u8]) {
    for p in pixels.chunks_exact_mut(4) {
        let a = u32::from(p[3]);
        let (b, g, r) = (u32::from(p[0]), u32::from(p[1]), u32::from(p[2]));
        let un = |c: u32| if a == 0 || a == 255 { c as u8 } else { ((c * 255 + a / 2) / a).min(255) as u8 };
        p[0] = un(r);
        p[1] = un(g);
        p[2] = un(b);
    }
}

fn render(path: &Path, size: u32) -> Result<String, String> {
    crate::com::ensure();
    let path_w = wide(&path.to_string_lossy());
    // SAFETY: the shell item and bitmap are released/deleted below; buffers are sized from the bitmap's own header.
    unsafe {
        let factory: IShellItemImageFactory = SHCreateItemFromParsingName(PCWSTR(path_w.as_ptr()), None)
            .map_err(|e| format!("Windows could not find that file: {e}"))?;
        let bitmap = factory
            .GetImage(SIZE { cx: size as i32, cy: size as i32 }, SIIGBF_RESIZETOFIT)
            .map_err(|e| format!("Windows has no thumbnail for that file: {e}"))?;
        let mut info = BITMAP::default();
        if GetObjectW(HGDIOBJ(bitmap.0), std::mem::size_of::<BITMAP>() as i32, Some((&mut info as *mut BITMAP).cast())) == 0 {
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
            return Err("Windows returned an unreadable thumbnail".to_owned());
        }
        let (w, h) = (info.bmWidth as u32, info.bmHeight as u32);
        let mut header = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w as i32,
                // Negative height asks for top-down rows.
                biHeight: -(h as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pixels = vec![0u8; w as usize * h as usize * 4];
        let dc = GetDC(None);
        let rows = GetDIBits(dc, bitmap, 0, h, Some(pixels.as_mut_ptr().cast()), &mut header, DIB_RGB_COLORS);
        ReleaseDC(None, dc);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        if rows == 0 {
            return Err("Windows returned an unreadable thumbnail".to_owned());
        }
        bgra_premultiplied_to_rgba(&mut pixels);
        Ok(image::png_data_url(&image::encode_png(&pixels, w, h)?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn premultiplied_pixels_are_restored() {
        let mut px = [50u8, 25, 100, 128];
        bgra_premultiplied_to_rgba(&mut px);
        assert_eq!(px, [199, 50, 100, 128]);
        let mut opaque = [1u8, 2, 3, 255];
        bgra_premultiplied_to_rgba(&mut opaque);
        assert_eq!(opaque, [3, 2, 1, 255]);
    }

    #[test]
    fn a_system_file_has_an_icon() {
        let notepad = Path::new(r"C:\Windows\System32\notepad.exe");
        if notepad.exists() {
            let url = Thumbs::default().get(notepad, 64, 0).expect("icon");
            assert!(url.starts_with("data:image/png;base64,"));
        }
    }

    #[test]
    fn a_missing_file_is_an_error_not_a_panic() {
        assert!(Thumbs::default().get(Path::new(r"C:\definitely\missing\file.xyz"), 64, 0).is_err());
    }
}
