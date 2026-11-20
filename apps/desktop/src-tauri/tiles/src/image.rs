//! Pixel helpers: Windows DIBs, PNG encoding and thumbnails. Pure code, no Windows calls.

use base64::Engine;

/// Bytes per pixel of the RGBA buffers used here.
const RGBA: usize = 4;
/// `BITMAPINFOHEADER.biCompression` values.
const BI_RGB: u32 = 0;
const BI_BITFIELDS: u32 = 3;
/// Size of `BITMAPINFOHEADER`; larger headers (V4, V5) start with the same fields.
const INFO_HEADER_SIZE: usize = 40;
/// Size of the three channel masks that follow a 40-byte header when `biCompression` is `BI_BITFIELDS`.
const MASKS_SIZE: usize = 12;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Dib {
    pub width: u32,
    pub height: u32,
    pub bits_per_pixel: u16,
    /// Rows are stored top to bottom (negative height in the header).
    pub top_down: bool,
    /// Offset of the first pixel row in the DIB bytes.
    pub pixels_at: usize,
    /// Bytes per stored row, padded to 4 bytes.
    pub stride: usize,
}

fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    bytes.get(at..at + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

fn i32_at(bytes: &[u8], at: usize) -> Option<i32> {
    u32_at(bytes, at).map(|v| v as i32)
}

fn u16_at(bytes: &[u8], at: usize) -> Option<u16> {
    bytes.get(at..at + 2).map(|b| u16::from_le_bytes([b[0], b[1]]))
}

/// Reads the header of a packed DIB (the `CF_DIB` clipboard format). Only the uncompressed 24 and 32 bit layouts
/// with the standard BGR(A) channel order are understood; everything else is None.
pub fn parse_dib(bytes: &[u8]) -> Option<Dib> {
    let header_size = u32_at(bytes, 0)? as usize;
    if header_size < INFO_HEADER_SIZE {
        return None;
    }
    let width = i32_at(bytes, 4)?;
    let height = i32_at(bytes, 8)?;
    let bits = u16_at(bytes, 14)?;
    let compression = u32_at(bytes, 16)?;
    if width <= 0
        || height == 0
        || !(bits == 24 || bits == 32)
        || !(compression == BI_RGB || compression == BI_BITFIELDS)
    {
        return None;
    }
    let masks = if compression == BI_BITFIELDS && header_size == INFO_HEADER_SIZE { MASKS_SIZE } else { 0 };
    if compression == BI_BITFIELDS && masks > 0 {
        // Only the common BGRA layout (red 0x00FF0000, green 0x0000FF00, blue 0x000000FF) is converted correctly.
        let (r, g, b) = (u32_at(bytes, header_size)?, u32_at(bytes, header_size + 4)?, u32_at(bytes, header_size + 8)?);
        if (r, g, b) != (0x00FF_0000, 0x0000_FF00, 0x0000_00FF) {
            return None;
        }
    }
    let width = width as u32;
    let stride = (width as usize * bits as usize).div_ceil(32) * 4;
    let dib = Dib {
        width,
        height: height.unsigned_abs(),
        bits_per_pixel: bits,
        top_down: height < 0,
        pixels_at: header_size + masks,
        stride,
    };
    let needed = dib.pixels_at.checked_add(stride.checked_mul(dib.height as usize)?)?;
    (bytes.len() >= needed).then_some(dib)
}

/// Converts the pixels of a parsed DIB to opaque top-down RGBA.
pub fn dib_to_rgba(dib: &Dib, bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(dib.width as usize * dib.height as usize * RGBA);
    let step = usize::from(dib.bits_per_pixel) / 8;
    for y in 0..dib.height as usize {
        let row = if dib.top_down { y } else { dib.height as usize - 1 - y };
        let start = dib.pixels_at + row * dib.stride;
        for x in 0..dib.width as usize {
            let p = start + x * step;
            out.extend_from_slice(&[bytes[p + 2], bytes[p + 1], bytes[p], 255]);
        }
    }
    out
}

/// Converts a top-down BGRA buffer (what GDI returns) to opaque RGBA in place.
pub fn bgra_to_rgba(pixels: &mut [u8]) {
    for p in pixels.as_chunks_mut::<RGBA>().0 {
        p.swap(0, 2);
        p[3] = 255;
    }
}

/// Shrinks RGBA pixels with a box filter so that the longer side is at most `max_side`. Never enlarges.
pub fn thumbnail(rgba: &[u8], width: u32, height: u32, max_side: u32) -> (Vec<u8>, u32, u32) {
    let longest = width.max(height);
    if longest <= max_side || max_side == 0 {
        return (rgba.to_vec(), width, height);
    }
    let scale = f64::from(longest) / f64::from(max_side);
    let tw = ((f64::from(width) / scale).round() as u32).max(1);
    let th = ((f64::from(height) / scale).round() as u32).max(1);
    let mut out = Vec::with_capacity(tw as usize * th as usize * RGBA);
    for ty in 0..th {
        let y0 = (f64::from(ty) * scale) as u32;
        let y1 = (((f64::from(ty) + 1.0) * scale).ceil() as u32).min(height).max(y0 + 1);
        for tx in 0..tw {
            let x0 = (f64::from(tx) * scale) as u32;
            let x1 = (((f64::from(tx) + 1.0) * scale).ceil() as u32).min(width).max(x0 + 1);
            let mut sum = [0u64; 3];
            let mut count = 0u64;
            for y in y0..y1 {
                for x in x0..x1 {
                    let p = (y as usize * width as usize + x as usize) * RGBA;
                    sum[0] += u64::from(rgba[p]);
                    sum[1] += u64::from(rgba[p + 1]);
                    sum[2] += u64::from(rgba[p + 2]);
                    count += 1;
                }
            }
            out.extend_from_slice(&[(sum[0] / count) as u8, (sum[1] / count) as u8, (sum[2] / count) as u8, 255]);
        }
    }
    (out, tw, th)
}

/// Encodes RGBA pixels as a PNG.
pub fn encode_png(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_compression(png::Compression::Fast);
    let mut writer = encoder.write_header().map_err(|e| format!("png header: {e}"))?;
    writer.write_image_data(rgba).map_err(|e| format!("png data: {e}"))?;
    writer.finish().map_err(|e| format!("png finish: {e}"))?;
    Ok(out)
}

/// `data:image/png;base64,...` for a PNG.
pub fn png_data_url(png: &[u8]) -> String {
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A bottom-up 24-bit DIB of 2x2 pixels (rows padded to 8 bytes): bottom row red, green; top row blue, white.
    fn sample_dib() -> Vec<u8> {
        let mut d = Vec::new();
        d.extend_from_slice(&40u32.to_le_bytes());
        d.extend_from_slice(&2i32.to_le_bytes());
        d.extend_from_slice(&2i32.to_le_bytes());
        d.extend_from_slice(&1u16.to_le_bytes());
        d.extend_from_slice(&24u16.to_le_bytes());
        d.extend_from_slice(&[0u8; 24]);
        // bottom row first: red then green (BGR order), 2 padding bytes
        d.extend_from_slice(&[0, 0, 255, 0, 255, 0, 0, 0]);
        // top row: blue then white
        d.extend_from_slice(&[255, 0, 0, 255, 255, 255, 0, 0]);
        d
    }

    #[test]
    fn a_bottom_up_dib_is_read_top_down() {
        let bytes = sample_dib();
        let dib = parse_dib(&bytes).expect("valid dib");
        assert_eq!((dib.width, dib.height, dib.stride), (2, 2, 8));
        let rgba = dib_to_rgba(&dib, &bytes);
        assert_eq!(&rgba[0..4], &[0, 0, 255, 255], "top-left is blue");
        assert_eq!(&rgba[4..8], &[255, 255, 255, 255], "top-right is white");
        assert_eq!(&rgba[8..12], &[255, 0, 0, 255], "bottom-left is red");
        assert_eq!(&rgba[12..16], &[0, 255, 0, 255], "bottom-right is green");
    }

    #[test]
    fn truncated_or_unsupported_dibs_are_rejected() {
        let bytes = sample_dib();
        assert!(parse_dib(&bytes[..bytes.len() - 1]).is_none());
        assert!(parse_dib(&[0u8; 10]).is_none());
        let mut palette = sample_dib();
        palette[14] = 8; // 8 bits per pixel: palette image
        assert!(parse_dib(&palette).is_none());
    }

    #[test]
    fn thumbnails_shrink_and_never_enlarge() {
        let rgba: Vec<u8> = (0..8 * 4).flat_map(|_| [10u8, 20, 30, 255]).collect();
        let (small, w, h) = thumbnail(&rgba, 8, 4, 4);
        assert_eq!((w, h), (4, 2));
        assert_eq!(&small[0..4], &[10, 20, 30, 255]);
        let (same, w, h) = thumbnail(&rgba, 8, 4, 100);
        assert_eq!((w, h, same.len()), (8, 4, rgba.len()));
    }

    #[test]
    fn png_round_trips_through_the_decoder() {
        let rgba = vec![1u8, 2, 3, 255, 4, 5, 6, 255];
        let bytes = encode_png(&rgba, 2, 1).unwrap();
        let mut reader = png::Decoder::new(std::io::Cursor::new(bytes)).read_info().unwrap();
        let mut buf = vec![0; reader.output_buffer_size().unwrap()];
        reader.next_frame(&mut buf).unwrap();
        assert_eq!(buf, rgba);
        assert!(png_data_url(&[1, 2, 3]).starts_with("data:image/png;base64,"));
    }

    #[test]
    fn bgra_becomes_opaque_rgba() {
        let mut px = [1u8, 2, 3, 0];
        bgra_to_rgba(&mut px);
        assert_eq!(px, [3, 2, 1, 255]);
    }
}
