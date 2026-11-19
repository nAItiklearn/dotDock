//! Pixels in, PNG out. Plain data, no Windows calls, so it is tested everywhere.

use std::io;

/// An 8-bit RGBA image with straight (not premultiplied) alpha, rows top to bottom.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rgba {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

const CHANNELS: usize = 4;
const OPAQUE: u32 = 255;

impl Rgba {
    /// From the bytes of a 32-bit bitmap (blue, green, red, alpha).
    pub fn from_bgra(width: u32, height: u32, bgra: &[u8], premultiplied: bool) -> Option<Rgba> {
        let len = width as usize * height as usize * CHANNELS;
        if len == 0 || bgra.len() < len {
            return None;
        }
        let mut pixels = Vec::with_capacity(len);
        for px in bgra[..len].as_chunks::<CHANNELS>().0 {
            pixels.extend_from_slice(&[px[2], px[1], px[0], px[3]]);
        }
        let mut image = Rgba { width, height, pixels };
        if premultiplied {
            premultiplied_to_straight(&mut image.pixels);
        }
        Some(image)
    }

    /// True when no pixel is visible; the shell sometimes returns an empty bitmap for an item with no icon.
    pub fn is_blank(&self) -> bool {
        self.pixels.as_chunks::<CHANNELS>().0.iter().all(|p| p[3] == 0)
    }

    /// The smaller edge of the image.
    pub fn short_edge(&self) -> u32 {
        self.width.min(self.height)
    }
}

/// Pixels with alpha below this count as empty when looking for where the picture is. High enough to ignore
/// the faint frame and shadow the shell draws around small icons.
const VISIBLE_ALPHA: u8 = 96;
/// A picture at most this many px across, centred in a bigger canvas, is a small native icon the shell
/// embedded as is (a 32 px `.ico` asked for at 256 px). Real 256 px artwork is never this small.
const SMALL_NATIVE_MAX: u32 = 72;
/// How far, in px (counted twice: it is a difference of sums), the middle of such a picture may be from the
/// middle of the canvas.
const NATIVE_TOLERANCE: u32 = 8;
/// How much of the canvas an enlarged small icon fills; 224 of 256 is the padding shell artwork has.
const ENLARGED_FILL: u32 = 224;

impl Rgba {
    /// The box (left, top, right, bottom, all inclusive) around the visible pixels.
    pub fn visible_bounds(&self) -> Option<(u32, u32, u32, u32)> {
        let (mut x0, mut y0, mut x1, mut y1) = (u32::MAX, u32::MAX, 0, 0);
        for (i, px) in self.pixels.as_chunks::<CHANNELS>().0.iter().enumerate() {
            if px[3] >= VISIBLE_ALPHA {
                let (x, y) = (i as u32 % self.width, i as u32 / self.width);
                (x0, y0, x1, y1) = (x0.min(x), y0.min(y), x1.max(x), y1.max(y));
            }
        }
        (x0 != u32::MAX).then_some((x0, y0, x1, y1))
    }

    /// If this is a small native icon floating in the middle of a big canvas, the same picture enlarged to
    /// fill the canvas the way full-size artwork does; `None` for anything else, including every real
    /// 256 px icon. The enlargement is a smooth bicubic resample of the cropped picture, so a 32 px icon
    /// is soft rather than blocky, and no larger than the canvas.
    pub fn enlarge_small_native(&self) -> Option<Rgba> {
        let (x0, y0, x1, y1) = self.visible_bounds()?;
        let (w, h) = (x1 - x0 + 1, y1 - y0 + 1);
        let centred = |lo: u32, hi: u32, edge: u32| (lo + hi).abs_diff(edge - 1) <= NATIVE_TOLERANCE;
        let small = w.max(h) <= SMALL_NATIVE_MAX;
        if !small || !centred(x0, x1, self.width) || !centred(y0, y1, self.height) {
            return None;
        }
        let fill = ENLARGED_FILL.min(self.width).min(self.height);
        let side = w.max(h);
        let mut out = Rgba { width: self.width, height: self.height, pixels: vec![0; self.pixels.len()] };
        let (ox, oy) = ((self.width - fill) / 2, (self.height - fill) / 2);
        for y in 0..fill {
            for x in 0..fill {
                // Centre of the output pixel mapped into the cropped source.
                let sx = (x as f32 + 0.5) * side as f32 / fill as f32 - 0.5 + (x0 as f32 - (side - w) as f32 / 2.0);
                let sy = (y as f32 + 0.5) * side as f32 / fill as f32 - 0.5 + (y0 as f32 - (side - h) as f32 / 2.0);
                let px = self.sample_bicubic(sx, sy);
                let i = ((oy + y) * self.width + ox + x) as usize * CHANNELS;
                out.pixels[i..i + CHANNELS].copy_from_slice(&px);
            }
        }
        Some(out)
    }

    /// Catmull-Rom sample at a fractional position, on premultiplied colour so transparent pixels do not
    /// bleed their colour into the edge.
    fn sample_bicubic(&self, x: f32, y: f32) -> [u8; 4] {
        fn weight(t: f32) -> f32 {
            let t = t.abs();
            if t < 1.0 {
                1.5 * t * t * t - 2.5 * t * t + 1.0
            } else if t < 2.0 {
                -0.5 * t * t * t + 2.5 * t * t - 4.0 * t + 2.0
            } else {
                0.0
            }
        }
        let (fx, fy) = (x.floor(), y.floor());
        let mut acc = [0f32; 4];
        for j in -1..=2 {
            for i in -1..=2 {
                let (px, py) = (fx as i32 + i, fy as i32 + j);
                let w = weight(x - px as f32) * weight(y - py as f32);
                if px < 0 || py < 0 || px >= self.width as i32 || py >= self.height as i32 {
                    continue;
                }
                let p = &self.pixels[(py as u32 * self.width + px as u32) as usize * CHANNELS..][..CHANNELS];
                let a = f32::from(p[3]) / 255.0;
                acc[0] += w * f32::from(p[0]) * a;
                acc[1] += w * f32::from(p[1]) * a;
                acc[2] += w * f32::from(p[2]) * a;
                acc[3] += w * a;
            }
        }
        let alpha = acc[3].clamp(0.0, 1.0);
        if alpha <= 0.0 {
            return [0; 4];
        }
        let straight = |c: f32| (c / alpha).clamp(0.0, 255.0).round() as u8;
        [straight(acc[0]), straight(acc[1]), straight(acc[2]), (alpha * 255.0).round() as u8]
    }
}

/// Divides each colour channel by alpha. The shell hands back bitmaps whose colours were multiplied by their
/// alpha, which shows as dark fringes on soft edges once it is treated as straight alpha.
pub fn premultiplied_to_straight(pixels: &mut [u8]) {
    for px in pixels.as_chunks_mut::<CHANNELS>().0.iter_mut() {
        let alpha = u32::from(px[3]);
        if alpha == 0 || alpha == OPAQUE {
            continue;
        }
        for channel in &mut px[..3] {
            let straight = (u32::from(*channel) * OPAQUE + alpha / 2) / alpha;
            *channel = straight.min(OPAQUE) as u8;
        }
    }
}

pub fn encode_png(image: &Rgba) -> io::Result<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, image.width, image.height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Fast);
        let mut writer = encoder.write_header().map_err(io::Error::other)?;
        writer.write_image_data(&image.pixels).map_err(io::Error::other)?;
    }
    Ok(out)
}

/// Decodes a PNG of any colour type into straight RGBA.
pub fn decode_png(bytes: &[u8]) -> io::Result<Rgba> {
    let mut decoder = png::Decoder::new(io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(io::Error::other)?;
    let mut buffer = vec![0; reader.output_buffer_size().ok_or_else(|| io::Error::other("image too large"))?];
    let info = reader.next_frame(&mut buffer).map_err(io::Error::other)?;
    let data = &buffer[..info.buffer_size()];
    let pixels = match info.color_type {
        png::ColorType::Rgba => data.to_vec(),
        png::ColorType::Rgb => data.as_chunks::<3>().0.iter().flat_map(|p| [p[0], p[1], p[2], u8::MAX]).collect(),
        png::ColorType::GrayscaleAlpha => {
            data.as_chunks::<2>().0.iter().flat_map(|p| [p[0], p[0], p[0], p[1]]).collect()
        }
        png::ColorType::Grayscale => data.iter().flat_map(|&g| [g, g, g, u8::MAX]).collect(),
        png::ColorType::Indexed => return Err(io::Error::other("palette image was not expanded")),
    };
    Ok(Rgba { width: info.width, height: info.height, pixels })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bgra_becomes_rgba() {
        let image = Rgba::from_bgra(1, 1, &[10, 20, 30, 255], false).unwrap();
        assert_eq!(image.pixels, [30, 20, 10, 255]);
    }

    #[test]
    fn short_or_empty_input_is_rejected() {
        assert!(Rgba::from_bgra(2, 2, &[0; 8], false).is_none());
        assert!(Rgba::from_bgra(0, 4, &[], false).is_none());
    }

    #[test]
    fn premultiplied_colours_are_restored() {
        // 50 % alpha over mid grey: stored as 64, straight value 128.
        let mut px = [64, 64, 64, 128];
        premultiplied_to_straight(&mut px);
        assert_eq!(px, [128, 128, 128, 128]);
        // Fully opaque and fully transparent pixels are left alone.
        let mut px = [10, 20, 30, 255, 7, 8, 9, 0];
        premultiplied_to_straight(&mut px);
        assert_eq!(px, [10, 20, 30, 255, 7, 8, 9, 0]);
    }

    #[test]
    fn restoring_never_overflows() {
        let mut px = [255, 255, 255, 10];
        premultiplied_to_straight(&mut px);
        assert_eq!(px, [255, 255, 255, 10]);
    }

    #[test]
    fn blank_images_are_detected() {
        assert!(Rgba { width: 1, height: 1, pixels: vec![9, 9, 9, 0] }.is_blank());
        assert!(!Rgba { width: 1, height: 1, pixels: vec![0, 0, 0, 1] }.is_blank());
    }

    fn canvas_with_box(edge: u32, x0: u32, y0: u32, w: u32, h: u32) -> Rgba {
        let mut image = Rgba { width: edge, height: edge, pixels: vec![0; (edge * edge * 4) as usize] };
        for y in y0..y0 + h {
            for x in x0..x0 + w {
                let i = ((y * edge + x) * 4) as usize;
                image.pixels[i..i + 4].copy_from_slice(&[200, 40, 40, 255]);
            }
        }
        image
    }

    #[test]
    fn a_small_native_icon_in_a_big_canvas_is_enlarged_to_fill_it() {
        // 32 px picture centred in 256: occupies 112..144.
        let enlarged = canvas_with_box(256, 112, 112, 32, 32).enlarge_small_native().unwrap();
        let (x0, y0, x1, y1) = enlarged.visible_bounds().unwrap();
        assert!((x1 - x0 + 1).abs_diff(ENLARGED_FILL) <= 2, "{x0}..{x1}");
        assert!((y1 - y0 + 1).abs_diff(ENLARGED_FILL) <= 2, "{y0}..{y1}");
        assert_eq!((enlarged.width, enlarged.height), (256, 256));
        // The colour survives the resample.
        let centre = ((128 * 256 + 128) * 4) as usize;
        assert_eq!(&enlarged.pixels[centre..centre + 4], &[200, 40, 40, 255]);
    }

    #[test]
    fn real_artwork_is_never_touched() {
        // Full-size artwork, artwork with a margin, a small off-centre picture, and an empty canvas.
        assert!(canvas_with_box(256, 8, 8, 240, 240).enlarge_small_native().is_none());
        assert!(canvas_with_box(256, 40, 40, 176, 176).enlarge_small_native().is_none());
        assert!(canvas_with_box(256, 10, 10, 32, 32).enlarge_small_native().is_none());
        assert!(canvas_with_box(256, 0, 0, 0, 0).enlarge_small_native().is_none());
    }

    #[test]
    fn a_small_picture_that_is_not_square_keeps_its_proportions() {
        // 44 x 34, centred: x 106..149, y 111..144.
        let enlarged = canvas_with_box(256, 106, 111, 44, 34).enlarge_small_native().unwrap();
        let (x0, y0, x1, y1) = enlarged.visible_bounds().unwrap();
        let (w, h) = (x1 - x0 + 1, y1 - y0 + 1);
        assert!(w.abs_diff(ENLARGED_FILL) <= 2, "{w}");
        assert!(h.abs_diff(ENLARGED_FILL * 34 / 44) <= 3, "{h}");
    }

    #[test]
    fn a_faint_frame_does_not_hide_a_small_icon() {
        let mut image = canvas_with_box(256, 112, 112, 32, 32);
        // One-pixel frame at 10 % alpha around the whole canvas, as the shell draws.
        for i in 0..256usize {
            for (x, y) in [(i, 0), (i, 255), (0, i), (255, i)] {
                image.pixels[(y * 256 + x) * 4 + 3] = 26;
            }
        }
        assert!(image.enlarge_small_native().is_some());
    }

    #[test]
    fn png_round_trips_with_alpha() {
        let image = Rgba { width: 2, height: 1, pixels: vec![255, 0, 0, 255, 0, 0, 255, 100] };
        let bytes = encode_png(&image).unwrap();
        assert_eq!(&bytes[1..4], b"PNG");
        assert_eq!(decode_png(&bytes).unwrap(), image);
    }
}
