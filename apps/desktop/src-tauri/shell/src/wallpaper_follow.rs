//! Following the Windows wallpaper: when the user picks another one, the theme re-derives its palette from it.
//!
//! Windows announces a change with `WM_SETTINGCHANGE` / `SPI_SETDESKWALLPAPER`, broadcast to top-level windows; the
//! dock host's hidden window already hears these and passes the wallpaper ones on. Nothing here polls or runs a timer:
//! a thread sleeps on a channel until an announcement arrives, waits for the burst Windows sends for one change to
//! go quiet, then judges the new wallpaper once.
//!
//! Two kinds of change are not followed: dotDock's own writes (Settings, the first start, the theme hand-over, the
//! restore), which would otherwise turn into a loop, and a wallpaper file that is missing or not an absolute path.
//! This module only reads. It never writes the record of the user's original wallpaper (the snapshot and the
//! hand-over record), so following can never overwrite it.

use crate::wallpaper;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

/// Windows sends several announcements for one change (each monitor, the transcoded copy). One judgement follows
/// once none has arrived for this long.
pub const QUIET: Duration = Duration::from_millis(400);

/// How long a write of dotDock's own stays expected. Windows announces it within a second; the margin covers a
/// slow shell, and a user change to another file is never mistaken for it, since paths are compared.
pub const OWN_WRITE_WINDOW: Duration = Duration::from_secs(10);

/// Wallpaper files dotDock itself set recently, each with when.
#[derive(Debug, Default)]
pub struct OwnWrites {
    recent: Vec<(PathBuf, Instant)>,
}

/// Windows compares paths without regard to case; so do we.
fn same_file(a: &Path, b: &Path) -> bool {
    a.as_os_str().to_string_lossy().eq_ignore_ascii_case(&b.as_os_str().to_string_lossy())
}

impl OwnWrites {
    pub fn note(&mut self, path: &Path, now: Instant) {
        self.forget_old(now);
        self.recent.push((path.to_path_buf(), now));
    }

    /// True when `path` is a write of dotDock's own that is still expected; that write is then used up.
    pub fn take(&mut self, path: &Path, now: Instant) -> bool {
        self.forget_old(now);
        match self.recent.iter().position(|(own, _)| same_file(own, path)) {
            Some(index) => {
                self.recent.remove(index);
                true
            }
            None => false,
        }
    }

    fn forget_old(&mut self, now: Instant) {
        self.recent.retain(|(_, at)| now.saturating_duration_since(*at) < OWN_WRITE_WINDOW);
    }
}

static OWN: Mutex<OwnWrites> = Mutex::new(OwnWrites { recent: Vec::new() });

/// Called by every code path that sets the wallpaper, just before it does.
pub fn note_own_write(path: &Path) {
    OWN.lock().unwrap_or_else(PoisonError::into_inner).note(path, Instant::now());
}

/// What to do about the wallpaper Windows now shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    /// The user chose this picture: the theme follows it.
    Follow(PathBuf),
    /// dotDock set it.
    Own,
    /// The file is missing or not an absolute path, so there is nothing to read the colours of.
    Missing(PathBuf),
    /// Windows shows a solid colour, or could not say what it shows.
    NoPicture,
}

pub fn judge(current: Option<PathBuf>, own: &mut OwnWrites, now: Instant, usable: impl Fn(&Path) -> bool) -> Verdict {
    let Some(path) = current else { return Verdict::NoPicture };
    if own.take(&path, now) {
        Verdict::Own
    } else if !usable(&path) {
        Verdict::Missing(path)
    } else {
        Verdict::Follow(path)
    }
}

/// Judges what Windows shows now, against the writes dotDock made itself.
pub fn judge_current() -> Verdict {
    let current = wallpaper::current().ok().flatten();
    judge(current, &mut OWN.lock().unwrap_or_else(PoisonError::into_inner), Instant::now(), wallpaper::is_usable)
}

/// Blocks until an announcement arrives, then until none has arrived for `quiet`. True when a change settled; false
/// once every sender is gone, which ends the follower.
pub fn settle(announcements: &Receiver<()>, quiet: Duration) -> bool {
    if announcements.recv().is_err() {
        return false;
    }
    loop {
        match announcements.recv_timeout(quiet) {
            Ok(()) => {}
            Err(RecvTimeoutError::Timeout) => return true,
            // The change still happened; the next call ends the follower.
            Err(RecvTimeoutError::Disconnected) => return true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;
    use std::thread;

    const SHORT: Duration = Duration::from_millis(40);
    const PROMPT: Duration = Duration::from_secs(5);

    fn usable(path: &Path) -> bool {
        path.is_absolute() && !path.to_string_lossy().contains("gone")
    }

    #[test]
    fn a_change_by_the_user_is_followed() {
        let mut own = OwnWrites::default();
        let picked = PathBuf::from(r"C:\Users\you\Pictures\coast.jpg");
        assert_eq!(judge(Some(picked.clone()), &mut own, Instant::now(), usable), Verdict::Follow(picked));
    }

    #[test]
    fn dotdocks_own_write_is_ignored_once_so_following_never_loops() {
        let mut own = OwnWrites::default();
        let now = Instant::now();
        let ours = PathBuf::from(r"C:\Program Files\dotDock\wallpapers\meadow.jpg");
        own.note(&ours, now);
        let upper = PathBuf::from(r"C:\PROGRAM FILES\DOTDOCK\WALLPAPERS\MEADOW.JPG");
        assert_eq!(judge(Some(upper), &mut own, now, usable), Verdict::Own, "Windows may change the case");
        assert_eq!(judge(Some(ours.clone()), &mut own, now, usable), Verdict::Follow(ours), "used up");
    }

    #[test]
    fn an_own_write_that_windows_never_announced_expires() {
        let mut own = OwnWrites::default();
        let then = Instant::now();
        let ours = PathBuf::from(r"C:\dotDock\meadow.jpg");
        own.note(&ours, then);
        let later = then + OWN_WRITE_WINDOW;
        assert_eq!(judge(Some(ours.clone()), &mut own, later, usable), Verdict::Follow(ours));
    }

    #[test]
    fn a_missing_or_relative_file_and_a_solid_colour_are_not_followed() {
        let mut own = OwnWrites::default();
        let now = Instant::now();
        let gone = PathBuf::from(r"C:\Users\you\Pictures\gone.jpg");
        assert_eq!(judge(Some(gone.clone()), &mut own, now, usable), Verdict::Missing(gone));
        let mangled = PathBuf::from(r":LOCALAPPDATA\dev.dotdock.desktop\original-wallpaper.jpeg");
        assert_eq!(judge(Some(mangled.clone()), &mut own, now, usable), Verdict::Missing(mangled));
        assert_eq!(judge(None, &mut own, now, usable), Verdict::NoPicture);
    }

    #[test]
    fn a_burst_of_announcements_settles_into_one_change() {
        let (tx, rx) = channel();
        for _ in 0..5 {
            tx.send(()).expect("send");
        }
        let started = Instant::now();
        assert!(settle(&rx, SHORT));
        assert!(started.elapsed() >= SHORT, "waited for the burst to go quiet");
        assert!(rx.try_recv().is_err(), "the whole burst was absorbed");
        drop(tx);
        assert!(!settle(&rx, SHORT), "no senders: the follower ends");
    }

    #[test]
    fn announcements_that_keep_coming_are_still_one_change_once_they_stop() {
        let (tx, rx) = channel();
        let sender = thread::spawn(move || {
            for _ in 0..4 {
                tx.send(()).expect("send");
                thread::sleep(SHORT / 4);
            }
        });
        let started = Instant::now();
        assert!(settle(&rx, SHORT));
        sender.join().expect("sender");
        assert!(rx.try_recv().is_err());
        assert!(started.elapsed() < PROMPT);
    }

    #[test]
    fn waiting_for_a_change_uses_no_timer() {
        let (tx, rx) = channel::<()>();
        let waiter = thread::spawn(move || settle(&rx, SHORT));
        thread::sleep(SHORT * 3);
        assert!(!waiter.is_finished(), "nothing announced: it sleeps on the channel, it does not tick");
        drop(tx);
        assert!(!waiter.join().expect("waiter"));
    }
}
