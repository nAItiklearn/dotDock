//! The WAV container and sample conversion for voice memos. Pure code.

/// Bytes of the canonical 44-byte header (RIFF, fmt chunk, data chunk header).
pub const HEADER_LEN: usize = 44;
/// Voice memos are written as 16-bit PCM, which every player understands.
pub const BITS: u16 = 16;

/// How the capture device delivers samples.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SampleFormat {
    Float32,
    Int16,
    Int24,
    Int32,
}

impl SampleFormat {
    pub fn bytes_per_sample(self) -> usize {
        match self {
            SampleFormat::Float32 | SampleFormat::Int32 => 4,
            SampleFormat::Int24 => 3,
            SampleFormat::Int16 => 2,
        }
    }
}

/// Converts raw device samples to 16-bit PCM and reports the loudest sample as 0 to 1.
pub fn to_pcm16(raw: &[u8], format: SampleFormat) -> (Vec<i16>, f32) {
    let step = format.bytes_per_sample();
    let mut peak = 0.0f32;
    let samples = raw
        .chunks_exact(step)
        .map(|c| {
            let unit = match format {
                SampleFormat::Float32 => f32::from_le_bytes([c[0], c[1], c[2], c[3]]),
                SampleFormat::Int16 => f32::from(i16::from_le_bytes([c[0], c[1]])) / 32768.0,
                SampleFormat::Int24 => (i32::from_le_bytes([0, c[0], c[1], c[2]]) >> 8) as f32 / 8_388_608.0,
                SampleFormat::Int32 => i32::from_le_bytes([c[0], c[1], c[2], c[3]]) as f32 / 2_147_483_648.0,
            }
            .clamp(-1.0, 1.0);
            peak = peak.max(unit.abs());
            (unit * 32767.0).round() as i16
        })
        .collect();
    (samples, peak)
}

/// The 44-byte header for `data_len` bytes of 16-bit PCM.
pub fn header(channels: u16, sample_rate: u32, data_len: u32) -> [u8; HEADER_LEN] {
    let block_align = channels * BITS / 8;
    let byte_rate = sample_rate * u32::from(block_align);
    let mut h = [0u8; HEADER_LEN];
    h[0..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&(36 + data_len).to_le_bytes());
    h[8..12].copy_from_slice(b"WAVE");
    h[12..16].copy_from_slice(b"fmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..22].copy_from_slice(&1u16.to_le_bytes()); // PCM
    h[22..24].copy_from_slice(&channels.to_le_bytes());
    h[24..28].copy_from_slice(&sample_rate.to_le_bytes());
    h[28..32].copy_from_slice(&byte_rate.to_le_bytes());
    h[32..34].copy_from_slice(&block_align.to_le_bytes());
    h[34..36].copy_from_slice(&BITS.to_le_bytes());
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&data_len.to_le_bytes());
    h
}

/// Length in milliseconds of a canonical PCM WAV, from its header and total file size.
pub fn duration_ms(file_head: &[u8], file_len: u64) -> Option<u64> {
    if file_head.len() < HEADER_LEN
        || &file_head[0..4] != b"RIFF"
        || &file_head[8..12] != b"WAVE"
        || &file_head[36..40] != b"data"
    {
        return None;
    }
    let byte_rate = u64::from(u32::from_le_bytes(file_head[28..32].try_into().ok()?));
    if byte_rate == 0 {
        return None;
    }
    let data_len = u64::from(u32::from_le_bytes(file_head[40..44].try_into().ok()?))
        .min(file_len.saturating_sub(HEADER_LEN as u64));
    Some(data_len * 1000 / byte_rate)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn float_samples_convert_and_report_the_peak() {
        let raw: Vec<u8> = [0.0f32, 0.5, -1.0, 2.0].iter().flat_map(|s| s.to_le_bytes()).collect();
        let (pcm, peak) = to_pcm16(&raw, SampleFormat::Float32);
        assert_eq!(pcm, [0, 16384, -32767, 32767]);
        assert_eq!(peak, 1.0);
    }

    #[test]
    fn integer_formats_scale_to_16_bit() {
        let (pcm, peak) = to_pcm16(&[0x00, 0x40], SampleFormat::Int16);
        assert_eq!(pcm, [16384]);
        assert!((peak - 0.5).abs() < 1e-3);
        let (pcm24, _) = to_pcm16(&[0x00, 0x00, 0x40], SampleFormat::Int24);
        assert_eq!(pcm24, [16384]);
        let (pcm32, _) = to_pcm16(&[0x00, 0x00, 0x00, 0x40], SampleFormat::Int32);
        assert_eq!(pcm32, [16384]);
    }

    #[test]
    fn a_partial_trailing_sample_is_ignored() {
        let (pcm, _) = to_pcm16(&[1, 2, 3], SampleFormat::Int16);
        assert_eq!(pcm.len(), 1);
    }

    #[test]
    fn the_header_describes_the_data() {
        let h = header(2, 48_000, 192_000);
        assert_eq!(&h[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(h[4..8].try_into().unwrap()), 36 + 192_000);
        assert_eq!(u32::from_le_bytes(h[28..32].try_into().unwrap()), 192_000, "byte rate = 48000 * 2 ch * 2 bytes");
        assert_eq!(duration_ms(&h, (HEADER_LEN + 192_000) as u64), Some(1000));
    }

    #[test]
    fn a_truncated_file_reports_the_real_length() {
        let h = header(1, 16_000, 1_000_000);
        // Only one second of the promised data is on disk.
        assert_eq!(duration_ms(&h, (HEADER_LEN + 32_000) as u64), Some(1000));
        assert_eq!(duration_ms(&[0u8; 10], 10), None);
    }
}
