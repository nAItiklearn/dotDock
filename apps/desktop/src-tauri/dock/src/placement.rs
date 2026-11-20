//! Where the dock window goes and how much screen the dock reserves. Plain arithmetic on pixel rectangles, so
//! every rule is tested without a screen.
//!
//! The dock window is a transparent sheet over one monitor: the bar sits against the edge it is docked to and
//! everything else (magnified icons, stack popovers, previews, the App Library) is drawn on the rest of the
//! sheet. The space the dock *reserves* (the app bar) is only the strip the bar itself occupies.

use crate::protocol::DockEdge;

/// A rectangle in physical pixels, edges as Win32 gives them (`right` and `bottom` are exclusive).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PxRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl PxRect {
    pub fn width(&self) -> i32 {
        self.right - self.left
    }

    pub fn height(&self) -> i32 {
        self.bottom - self.top
    }
}

/// Smallest and largest icon the dock UI draws, in px at 100 % scaling. Mirrors `ICON_LIMITS` in
/// `src/dock/geometry.ts`: the UI clamps the setting the same way, so the strip reserved here matches the bar drawn.
pub const ICON_MIN: u32 = 32;
pub const ICON_MAX: u32 = 80;
/// Padding inside the bar and gap to the screen edge, as ratios of the icon size. Mirror `RATIO.pad` and
/// `RATIO.edge` in `src/dock/geometry.ts`.
const PAD_RATIO: f64 = 0.17;
const EDGE_RATIO: f64 = 0.2;
/// The bar keeps the edge gap on both sides: against the screen edge and against the windows above it.
const EDGE_GAPS: f64 = 2.0;

/// Depth of the strip the dock reserves, in CSS px at 100 % scaling: the bar (icon plus padding both sides)
/// and the gap on each side of it.
pub fn reserve_depth_css(icon_size: u32) -> f64 {
    let icon = f64::from(icon_size.clamp(ICON_MIN, ICON_MAX));
    let pad = (icon * PAD_RATIO).round();
    let edge = (icon * EDGE_RATIO).round();
    icon + 2.0 * pad + EDGE_GAPS * edge
}

/// Depth of the reserved strip in physical pixels at `scale` (1.25 for 125 % scaling).
pub fn reserve_depth_px(icon_size: u32, scale: f64) -> i32 {
    (reserve_depth_css(icon_size) * scale).ceil() as i32
}

/// The rectangle of the dock window.
///
/// - With a granted strip (the app bar is registered) the window runs from the strip's outer edge, which is
///   where other bars stopped, to the opposite edge of the monitor.
/// - Floating, it runs from the edge of the work area, so the dock rests above a visible taskbar instead of
///   over it.
///
/// The other axis always spans the whole monitor: the sheet has to hold popovers and the App Library.
pub fn window_rect(monitor: PxRect, work: PxRect, edge: DockEdge, granted: Option<PxRect>) -> PxRect {
    let docked = granted.unwrap_or(work);
    match edge {
        DockEdge::Bottom => PxRect { bottom: docked.bottom, ..monitor },
        DockEdge::Top => PxRect { top: docked.top, ..monitor },
        DockEdge::Left => PxRect { left: docked.left, ..monitor },
        DockEdge::Right => PxRect { right: docked.right, ..monitor },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MONITOR: PxRect = PxRect { left: 0, top: 0, right: 1920, bottom: 1080 };
    /// A visible 48 px taskbar along the bottom.
    const WORK: PxRect = PxRect { left: 0, top: 0, right: 1920, bottom: 1032 };

    #[test]
    fn the_reserved_strip_holds_the_bar_and_a_gap_each_side() {
        // 48 px icons: padding 8, edge gap 10 -> 48 + 16 + 20.
        assert_eq!(reserve_depth_css(48), 84.0);
        assert_eq!(reserve_depth_css(32), 32.0 + 2.0 * 5.0 + 2.0 * 6.0);
        assert_eq!(reserve_depth_css(80), 80.0 + 2.0 * 14.0 + 2.0 * 16.0);
    }

    #[test]
    fn icon_sizes_outside_the_ui_limits_reserve_what_the_ui_draws() {
        assert_eq!(reserve_depth_css(0), reserve_depth_css(ICON_MIN));
        assert_eq!(reserve_depth_css(500), reserve_depth_css(ICON_MAX));
    }

    #[test]
    fn the_strip_scales_with_the_display() {
        assert_eq!(reserve_depth_px(48, 1.0), 84);
        assert_eq!(reserve_depth_px(48, 1.25), 105);
        assert_eq!(reserve_depth_px(48, 2.0), 168);
        // Never rounds down into the bar.
        assert_eq!(reserve_depth_px(48, 1.01), 85);
    }

    #[test]
    fn a_reserving_dock_starts_where_the_other_bars_stop() {
        // The taskbar holds the bottom 48 px, so the system grants the strip above it.
        let granted = PxRect { left: 0, top: 948, right: 1920, bottom: 1032 };
        let window = window_rect(MONITOR, WORK, DockEdge::Bottom, Some(granted));
        assert_eq!(window, PxRect { left: 0, top: 0, right: 1920, bottom: 1032 });
    }

    #[test]
    fn a_floating_dock_rests_on_the_work_area() {
        assert_eq!(window_rect(MONITOR, WORK, DockEdge::Bottom, None), PxRect { bottom: 1032, ..MONITOR });
        let side = PxRect { left: 60, ..MONITOR };
        assert_eq!(window_rect(MONITOR, side, DockEdge::Left, None), side);
    }

    #[test]
    fn every_edge_keeps_the_far_side_of_the_monitor() {
        let granted = |edge| match edge {
            DockEdge::Bottom => PxRect { top: 996, ..MONITOR },
            DockEdge::Top => PxRect { bottom: 84, ..MONITOR },
            DockEdge::Left => PxRect { right: 84, ..MONITOR },
            DockEdge::Right => PxRect { left: 1836, ..MONITOR },
        };
        let rect = |edge| window_rect(MONITOR, MONITOR, edge, Some(granted(edge)));
        assert_eq!(rect(DockEdge::Bottom), MONITOR);
        assert_eq!(rect(DockEdge::Top), MONITOR);
        assert_eq!(rect(DockEdge::Left), MONITOR);
        assert_eq!(rect(DockEdge::Right), MONITOR);
    }

    #[test]
    fn a_bar_on_a_secondary_monitor_keeps_its_offset() {
        let second = PxRect { left: 1920, top: 0, right: 3840, bottom: 1080 };
        let granted = PxRect { left: 1920, top: 996, right: 3840, bottom: 1080 };
        assert_eq!(window_rect(second, second, DockEdge::Bottom, Some(granted)), second);
    }
}
