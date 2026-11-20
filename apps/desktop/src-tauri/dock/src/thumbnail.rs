//! Live DWM thumbnails of other windows, drawn by the compositor into one of our windows.
//!
//! `DwmRegisterThumbnail` makes DWM draw a live copy of a source window inside a destination window of this
//! process; no pixels pass through the dock, so a preview costs the compositor a blit and the dock nothing.
//! The copy is drawn above the destination's own content, so the dock window (the host) must leave the
//! area free. Registering and placing are plain calls, valid from any thread of the process.

use crate::protocol::Rect as CssRect;
use std::io;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::{
    DwmQueryThumbnailSourceSize, DwmRegisterThumbnail, DwmUnregisterThumbnail, DwmUpdateThumbnailProperties,
    DWM_THUMBNAIL_PROPERTIES, DWM_TNP_OPACITY, DWM_TNP_RECTDESTINATION, DWM_TNP_SOURCECLIENTAREAONLY, DWM_TNP_VISIBLE,
};

/// Widest and tallest a preview is drawn, in CSS px at 100 % scaling.
pub const MAX_WIDTH: f64 = 240.0;
pub const MAX_HEIGHT: f64 = 150.0;
/// Space between previews, and between the previews and the item they belong to, in CSS px.
pub const GAP: f64 = 12.0;

/// One registered thumbnail; unregistered when dropped.
pub struct Thumbnail {
    handle: isize,
}

impl Thumbnail {
    pub fn register(destination: isize, source: isize) -> io::Result<Thumbnail> {
        // SAFETY: both are window handles; DWM validates them and the destination must belong to this process.
        let handle = unsafe { DwmRegisterThumbnail(hwnd(destination), hwnd(source)) }.map_err(io::Error::other)?;
        Ok(Thumbnail { handle })
    }

    /// Size in px of the source window.
    pub fn source_size(&self) -> io::Result<(i32, i32)> {
        // SAFETY: plain query on our thumbnail handle.
        let size = unsafe { DwmQueryThumbnailSourceSize(self.handle) }.map_err(io::Error::other)?;
        Ok((size.cx, size.cy))
    }

    /// Draws the thumbnail into `rect` (px, in the destination's client coordinates).
    pub fn place(&self, rect: RECT, opacity: u8) -> io::Result<()> {
        let properties = DWM_THUMBNAIL_PROPERTIES {
            dwFlags: DWM_TNP_RECTDESTINATION | DWM_TNP_VISIBLE | DWM_TNP_OPACITY | DWM_TNP_SOURCECLIENTAREAONLY,
            rcDestination: rect,
            fVisible: true.into(),
            opacity,
            fSourceClientAreaOnly: true.into(),
            ..Default::default()
        };
        // SAFETY: `properties` is fully initialised for the flags set.
        unsafe { DwmUpdateThumbnailProperties(self.handle, &properties) }.map_err(io::Error::other)
    }
}

impl Drop for Thumbnail {
    fn drop(&mut self) {
        // SAFETY: unregisters the handle this value owns, once.
        unsafe {
            let _ = DwmUnregisterThumbnail(self.handle);
        }
    }
}

fn hwnd(value: isize) -> HWND {
    HWND(value as *mut _)
}

/// The previews currently shown above the dock; replacing them drops (unregisters) the old ones.
#[derive(Default)]
pub struct Previews {
    shown: Vec<Thumbnail>,
}

impl Previews {
    /// Shows live previews of `sources` in a row above `anchor` (CSS px, relative to the host window), centred
    /// on it and kept inside the host's width. `scale` is the host's DPI scale factor. Windows that cannot be
    /// previewed (closed meanwhile) are skipped.
    pub fn show(&mut self, host: isize, sources: &[isize], anchor: CssRect, scale: f64, host_width_px: i32) {
        self.shown.clear();
        let registered: Vec<(Thumbnail, (i32, i32))> = sources
            .iter()
            .filter_map(|&s| {
                let t = Thumbnail::register(host, s).ok()?;
                let size = t.source_size().ok().filter(|(w, h)| *w > 0 && *h > 0)?;
                Some((t, size))
            })
            .collect();
        let sizes: Vec<(i32, i32)> = registered.iter().map(|(_, s)| *s).collect();
        let rects = layout(&sizes, anchor, scale, host_width_px);
        for ((thumbnail, _), rect) in registered.into_iter().zip(rects) {
            if thumbnail.place(rect, u8::MAX).is_ok() {
                self.shown.push(thumbnail);
            }
        }
    }

    pub fn hide(&mut self) {
        self.shown.clear();
    }

    pub fn count(&self) -> usize {
        self.shown.len()
    }
}

/// Where each preview goes: a row above `anchor`, every preview scaled down to fit `MAX_WIDTH` by
/// `MAX_HEIGHT` (never up), bottom edges level, the row centred on the anchor and shifted to stay inside
/// `0..host_width_px`. Pure arithmetic, so it is tested without a screen.
pub fn layout(sizes: &[(i32, i32)], anchor: CssRect, scale: f64, host_width_px: i32) -> Vec<RECT> {
    let fitted: Vec<(f64, f64)> = sizes
        .iter()
        .map(|&(w, h)| {
            let (w, h) = (f64::from(w), f64::from(h));
            let factor = ((MAX_WIDTH * scale) / w).min((MAX_HEIGHT * scale) / h).min(1.0);
            (w * factor, h * factor)
        })
        .collect();
    let gap = GAP * scale;
    let total: f64 = fitted.iter().map(|(w, _)| w).sum::<f64>() + gap * fitted.len().saturating_sub(1) as f64;
    let centre = (anchor.x + anchor.w / 2.0) * scale;
    let max_left = (f64::from(host_width_px) - total).max(0.0);
    let mut x = (centre - total / 2.0).clamp(0.0, max_left);
    let bottom = anchor.y * scale - gap;
    fitted
        .into_iter()
        .map(|(w, h)| {
            let rect = RECT {
                left: x.round() as i32,
                top: (bottom - h).round() as i32,
                right: (x + w).round() as i32,
                bottom: bottom.round() as i32,
            };
            x += w + gap;
            rect
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const ANCHOR: CssRect = CssRect { x: 400.0, y: 700.0, w: 60.0, h: 60.0 };

    #[test]
    fn a_big_window_is_scaled_down_to_fit() {
        let rects = layout(&[(1920, 1080)], ANCHOR, 1.0, 1920);
        let r = rects[0];
        assert!(r.right - r.left <= MAX_WIDTH as i32 && r.bottom - r.top <= MAX_HEIGHT as i32);
        // 16:9 stays 16:9.
        let ratio = f64::from(r.right - r.left) / f64::from(r.bottom - r.top);
        assert!((ratio - 16.0 / 9.0).abs() < 0.05, "{ratio}");
    }

    #[test]
    fn a_small_window_is_never_enlarged() {
        let rects = layout(&[(100, 60)], ANCHOR, 1.0, 1920);
        assert_eq!((rects[0].right - rects[0].left, rects[0].bottom - rects[0].top), (100, 60));
    }

    #[test]
    fn the_row_sits_above_the_anchor_and_is_centred_on_it() {
        let rects = layout(&[(240, 150), (240, 150)], ANCHOR, 1.0, 1920);
        assert!(rects.iter().all(|r| r.bottom <= ANCHOR.y as i32 - GAP as i32 + 1));
        let left = rects[0].left;
        let right = rects[1].right;
        let middle = f64::from(left + right) / 2.0;
        assert!((middle - (ANCHOR.x + ANCHOR.w / 2.0)).abs() <= 1.0, "{middle}");
        assert_eq!(rects[1].left - rects[0].right, GAP as i32);
        assert_eq!(rects[0].bottom, rects[1].bottom);
    }

    #[test]
    fn the_row_stays_inside_the_host() {
        let near_left = CssRect { x: 0.0, ..ANCHOR };
        assert_eq!(layout(&[(240, 150), (240, 150)], near_left, 1.0, 1920)[0].left, 0);
        let near_right = CssRect { x: 1900.0, ..ANCHOR };
        let rects = layout(&[(240, 150), (240, 150)], near_right, 1.0, 1920);
        assert!(rects[1].right <= 1920, "{}", rects[1].right);
    }

    #[test]
    fn scaling_the_display_scales_the_row() {
        let one = layout(&[(1920, 1080)], ANCHOR, 1.0, 4000)[0];
        let two = layout(&[(1920, 1080)], ANCHOR, 2.0, 4000)[0];
        assert!((f64::from(two.right - two.left) / f64::from(one.right - one.left) - 2.0).abs() < 0.05);
    }

    #[test]
    fn no_sources_no_rects() {
        assert!(layout(&[], ANCHOR, 1.0, 1920).is_empty());
    }
}
