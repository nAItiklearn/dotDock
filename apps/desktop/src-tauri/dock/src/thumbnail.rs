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
use windows::Win32::UI::WindowsAndMessaging::IsIconic;

/// Space between the slots of the preview card's well, in CSS px (`PREVIEW.slotGap` in the dock UI).
pub const SLOT_GAP: f64 = 10.0;

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
    /// Shows live previews of `sources` inside `well` (CSS px, relative to the host window): the preview card's
    /// row of slots, one per source, in order. `scale` is the host's DPI scale factor. A minimised window has no
    /// live picture (DWM keeps only its title bar), so its slot is left to the card, which draws a placeholder.
    /// Windows that cannot be previewed (closed meanwhile) are skipped.
    pub fn show(&mut self, host: isize, sources: &[isize], well: CssRect, scale: f64) {
        self.shown.clear();
        let slots = slots(well, sources.len(), scale);
        for (&source, slot) in sources.iter().zip(slots) {
            // SAFETY: IsIconic accepts any handle and answers false for a stale one.
            if unsafe { IsIconic(hwnd(source)) }.as_bool() {
                continue;
            }
            let Ok(thumbnail) = Thumbnail::register(host, source) else { continue };
            let Some(size) = thumbnail.source_size().ok().filter(|(w, h)| *w > 0 && *h > 0) else { continue };
            if thumbnail.place(fit(size, slot), u8::MAX).is_ok() {
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

/// The well split into `count` equal slots with `SLOT_GAP` between them, in physical px.
pub fn slots(well: CssRect, count: usize, scale: f64) -> Vec<(f64, f64, f64, f64)> {
    if count == 0 {
        return Vec::new();
    }
    let n = count as f64;
    let w = (well.w - SLOT_GAP * (n - 1.0)) / n;
    (0..count)
        .map(|i| ((well.x + i as f64 * (w + SLOT_GAP)) * scale, well.y * scale, w * scale, well.h * scale))
        .collect()
}

/// A source of `size` px scaled to fit inside `slot` (never enlarged), centred in it.
pub fn fit((sw, sh): (i32, i32), (x, y, w, h): (f64, f64, f64, f64)) -> RECT {
    let (sw, sh) = (f64::from(sw), f64::from(sh));
    let factor = (w / sw).min(h / sh).min(1.0);
    let (fw, fh) = (sw * factor, sh * factor);
    let left = x + (w - fw) / 2.0;
    let top = y + (h - fh) / 2.0;
    RECT {
        left: left.round() as i32,
        top: top.round() as i32,
        right: (left + fw).round() as i32,
        bottom: (top + fh).round() as i32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WELL: CssRect = CssRect { x: 100.0, y: 600.0, w: 410.0, h: 126.0 };

    #[test]
    fn slots_split_the_well_with_the_card_gap() {
        let s = slots(WELL, 2, 1.0);
        assert_eq!(s, vec![(100.0, 600.0, 200.0, 126.0), (310.0, 600.0, 200.0, 126.0)]);
        assert!(slots(WELL, 0, 1.0).is_empty());
    }

    #[test]
    fn the_display_scale_turns_css_px_into_physical_px() {
        let s = slots(CssRect { w: 200.0, ..WELL }, 1, 1.25);
        assert_eq!(s, vec![(125.0, 750.0, 250.0, 157.5)]);
    }

    #[test]
    fn a_big_window_fits_its_slot_keeping_its_shape_and_is_centred() {
        let r = fit((1920, 1080), (0.0, 0.0, 200.0, 126.0));
        assert_eq!((r.right - r.left, r.bottom - r.top), (200, 112));
        assert_eq!(r.top, 7, "centred vertically");
        let tall = fit((800, 1600), (0.0, 0.0, 200.0, 126.0));
        assert_eq!((tall.left, tall.right), (69, 132), "centred horizontally");
    }

    #[test]
    fn a_small_window_is_never_enlarged() {
        let r = fit((100, 60), (0.0, 0.0, 200.0, 126.0));
        assert_eq!((r.left, r.top, r.right, r.bottom), (50, 33, 150, 93));
    }
}
