//! Test support for the two tests that need real sound (the microphone meter and the voice memo recorder).
//!
//! They open the speakers' loopback, because Windows can block microphone access machine-wide, and play a short
//! system sound so there is something to measure. That is audible, so those tests are `#[ignore]`d and run on
//! purpose: `cargo test -p dotdock-tiles -- --ignored`. A process plays one sound at a time, so the sound is also
//! guarded by a lock that makes the two tests take turns.

use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};
use windows::core::PCWSTR;
use windows::Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_FILENAME, SND_PURGE};

const SOUND: &str = r"C:\Windows\Media\ding.wav";
/// How long a test waits for the loopback to report the sound before it fails.
pub const HEAR_WITHIN: Duration = Duration::from_secs(10);
/// The sound is played again this often while waiting, in case the first one ended before the stream was ready.
const REPLAY_EVERY: Duration = Duration::from_millis(900);

static SPEAKERS: Mutex<()> = Mutex::new(());

/// Holds the speakers for one test; the sound stops when this is dropped.
pub struct Speakers {
    _turn: MutexGuard<'static, ()>,
    last_played: Instant,
}

impl Speakers {
    pub fn take() -> Self {
        let turn = SPEAKERS.lock().unwrap_or_else(PoisonError::into_inner);
        play();
        Self { _turn: turn, last_played: Instant::now() }
    }

    /// Plays the sound again once the previous one has had time to finish.
    pub fn keep_playing(&mut self) {
        if self.last_played.elapsed() >= REPLAY_EVERY {
            play();
            self.last_played = Instant::now();
        }
    }
}

impl Drop for Speakers {
    fn drop(&mut self) {
        // SAFETY: a null sound with SND_PURGE stops what this process is playing.
        let _ = unsafe { PlaySoundW(PCWSTR::null(), None, SND_PURGE) };
    }
}

fn play() {
    let path = crate::com::wide(SOUND);
    // SAFETY: the path is NUL-terminated and outlives the call; SND_ASYNC returns at once and Windows reads the file.
    let _ = unsafe { PlaySoundW(PCWSTR(path.as_ptr()), None, SND_FILENAME | SND_ASYNC) };
}
