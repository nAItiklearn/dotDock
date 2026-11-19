//! The island's own chimes, synthesised at run time so no audio asset (and no licence) is involved.
//! Each one is a couple of soft sine blips, short enough to never get in the way.

use serde::Deserialize;

const SAMPLE_RATE: u32 = 44_100;
/// Leaves headroom so the sum of a blip and its harmonic never clips at full volume.
const PEAK: f64 = 0.55;
const HARMONIC: f64 = 0.22;
const ATTACK_SECS: f64 = 0.004;
const RELEASE_SECS: f64 = 0.012;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Chime {
    /// A task finished: two rising blips.
    Done,
    /// The agent needs you: two quick equal knocks.
    Attention,
    /// A limit or an error: two falling blips.
    Problem,
}

/// (frequency Hz, start s, length s, decay rate per s)
fn notes(chime: Chime) -> &'static [(f64, f64, f64, f64)] {
    match chime {
        Chime::Done => &[(880.0, 0.0, 0.11, 22.0), (1318.5, 0.09, 0.2, 14.0)],
        Chime::Attention => &[(987.8, 0.0, 0.07, 30.0), (987.8, 0.11, 0.1, 26.0)],
        Chime::Problem => &[(523.3, 0.0, 0.14, 18.0), (392.0, 0.12, 0.24, 12.0)],
    }
}

/// A complete mono 16-bit PCM WAV file.
pub fn synth(chime: Chime, volume: f64) -> Vec<u8> {
    let gain = if volume.is_finite() { volume.clamp(0.0, 1.0) } else { 0.0 } * PEAK;
    let notes = notes(chime);
    let total_secs = notes.iter().map(|(_, start, len, _)| start + len).fold(0.0, f64::max);
    let frames = (total_secs * f64::from(SAMPLE_RATE)).ceil() as usize;
    let mut samples = vec![0.0f64; frames];
    for &(freq, start, length, decay) in notes {
        let first = (start * f64::from(SAMPLE_RATE)) as usize;
        let count = (length * f64::from(SAMPLE_RATE)) as usize;
        for i in 0..count {
            let Some(slot) = samples.get_mut(first + i) else { break };
            let t = i as f64 / f64::from(SAMPLE_RATE);
            let phase = std::f64::consts::TAU * freq * t;
            let attack = (t / ATTACK_SECS).min(1.0);
            let release = ((length - t) / RELEASE_SECS).clamp(0.0, 1.0);
            let envelope = attack * release * (-decay * t).exp();
            *slot += (phase.sin() + HARMONIC * (2.0 * phase).sin()) * envelope;
        }
    }
    let pcm: Vec<u8> = samples
        .iter()
        .flat_map(|s| {
            ((s * gain * f64::from(i16::MAX)).round().clamp(f64::from(i16::MIN), f64::from(i16::MAX)) as i16)
                .to_le_bytes()
        })
        .collect();
    let data_len = pcm.len() as u32;
    let mut wav = Vec::with_capacity(44 + pcm.len());
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    wav.extend_from_slice(&(SAMPLE_RATE * 2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    wav.extend_from_slice(&pcm);
    wav
}

#[cfg(windows)]
mod imp {
    use std::sync::Mutex;
    use windows::core::PCWSTR;
    use windows::Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_MEMORY, SND_NODEFAULT};

    /// PlaySound with SND_MEMORY reads from this buffer while it plays, so it must stay alive until the next sound.
    static PLAYING: Mutex<Option<Vec<u8>>> = Mutex::new(None);

    pub fn play(wav: Vec<u8>) {
        let Ok(mut slot) = PLAYING.lock() else { return };
        let previous = slot.replace(wav);
        let Some(buffer) = slot.as_ref() else { return };
        // SAFETY: SND_MEMORY treats the pointer as a WAV image. The buffer is owned by the static above, which
        // outlives this call and is only replaced after the next PlaySoundW has stopped the current sound.
        unsafe {
            let _ = PlaySoundW(PCWSTR(buffer.as_ptr().cast()), None, SND_MEMORY | SND_ASYNC | SND_NODEFAULT);
        }
        drop(previous);
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn play(_wav: Vec<u8>) {}
}

/// Plays a chime without blocking. A volume of zero is silent and does nothing.
pub fn play(chime: Chime, volume: f64) {
    if volume.is_finite() && volume > 0.0 {
        imp::play(synth(chime, volume));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn samples(wav: &[u8]) -> Vec<i16> {
        wav[44..].as_chunks::<2>().0.iter().map(|c| i16::from_le_bytes(*c)).collect()
    }

    #[test]
    fn produces_a_valid_wav_header() {
        let wav = synth(Chime::Done, 1.0);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..16], b"WAVEfmt ");
        assert_eq!(u32::from_le_bytes(wav[4..8].try_into().expect("len")) as usize, wav.len() - 8);
        assert_eq!(u32::from_le_bytes(wav[24..28].try_into().expect("rate")), SAMPLE_RATE);
        assert_eq!(&wav[36..40], b"data");
        assert_eq!(u32::from_le_bytes(wav[40..44].try_into().expect("data")) as usize, wav.len() - 44);
    }

    #[test]
    fn every_chime_is_short_audible_and_never_clips() {
        for chime in [Chime::Done, Chime::Attention, Chime::Problem] {
            let pcm = samples(&synth(chime, 1.0));
            let seconds = pcm.len() as f64 / f64::from(SAMPLE_RATE);
            assert!((0.15..0.5).contains(&seconds), "{chime:?} lasts {seconds}s");
            let peak = pcm.iter().map(|s| s.unsigned_abs()).max().expect("samples");
            assert!(peak > 8_000 && peak < 30_000, "{chime:?} peak {peak}");
            assert!(pcm.last().is_some_and(|s| s.unsigned_abs() < 200), "{chime:?} ends quietly, no click");
        }
    }

    #[test]
    fn volume_scales_the_signal_and_zero_is_silence() {
        let loud = samples(&synth(Chime::Done, 1.0)).iter().map(|s| s.unsigned_abs()).max().expect("loud");
        let soft = samples(&synth(Chime::Done, 0.25)).iter().map(|s| s.unsigned_abs()).max().expect("soft");
        assert!(soft < loud / 3 && soft > loud / 5);
        assert!(samples(&synth(Chime::Done, 0.0)).iter().all(|s| *s == 0));
        assert!(samples(&synth(Chime::Done, f64::NAN)).iter().all(|s| *s == 0));
    }
}
