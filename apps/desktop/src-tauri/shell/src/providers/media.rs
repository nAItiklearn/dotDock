//! Now-playing data and transport controls from Windows' system media session
//! (the same source as the volume-flyout media card). Works with any app that
//! publishes a media session: Spotify, browsers, media players.
//!
//! Nothing is polled: the session manager and the current session raise events
//! (`CurrentSessionChanged`, `PlaybackInfoChanged`, `MediaPropertiesChanged`,
//! `TimelinePropertiesChanged`) and each one wakes the reader. The UI advances the
//! progress bar from the last timeline position on its own.

use base64::Engine;
use serde::Serialize;
use std::sync::mpsc::Sender;
use std::time::Duration;
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Storage::Streams::DataReader;

/// When a read is not complete yet (cover art a moment late, or a read that failed mid track
/// change), read again this soon, a bounded number of times; otherwise only events wake the reader.
pub const RETRY_AFTER: Duration = Duration::from_millis(500);
/// A failed read is retried this many times before the reader waits for the next event.
const TRANSIENT_ATTEMPTS: u8 = 4;

/// WinRT TimeSpan ticks are 100 ns.
const TICKS_PER_SECOND: f64 = 10_000_000.0;
/// Artwork bigger than this is skipped rather than shipped over IPC.
const MAX_ARTWORK_BYTES: u64 = 2 * 1024 * 1024;
/// Many apps publish cover art a moment after the metadata; retry this many reads per track.
const ARTWORK_ATTEMPTS: u8 = 6;
/// WinRT DateTime counts 100 ns ticks from 1601-01-01; this is the Unix epoch in those ticks.
const UNIX_EPOCH_TICKS: i64 = 116_444_736_000_000_000;
const TICKS_PER_MS: i64 = 10_000;
/// A position this far from the extrapolated one means a seek, so the UI must hear about it.
const SEEK_TOLERANCE_SECONDS: f64 = 2.0;

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MediaData {
    pub title: String,
    pub artist: String,
    pub album: String,
    /// `data:` URL of the cover image, or None when the app supplies none.
    pub artwork: Option<String>,
    #[serde(rename = "positionSec")]
    pub position_seconds: f64,
    #[serde(rename = "durationSec")]
    pub duration_seconds: f64,
    /// Unix ms when `position_seconds` was sampled; the UI extrapolates from it while playing.
    pub sampled_at_ms: u64,
    pub playing: bool,
    pub can_seek: bool,
    pub can_next: bool,
    pub can_prev: bool,
    pub can_play_pause: bool,
}

impl MediaData {
    /// Equal apart from the playback clock, so callers can skip sending unchanged state.
    pub fn same_track_state(&self, other: &Self) -> bool {
        let strip = |d: &Self| Self { position_seconds: 0.0, sampled_at_ms: 0, ..d.clone() };
        strip(self) == strip(other)
    }

    /// True when `later`'s position is not where this sample's clock predicts (a seek or a stall).
    pub fn clock_drifted(&self, later: &Self) -> bool {
        let elapsed = later.sampled_at_ms.saturating_sub(self.sampled_at_ms) as f64 / 1000.0;
        let predicted = if self.playing { self.position_seconds + elapsed } else { self.position_seconds };
        (predicted - later.position_seconds).abs() > SEEK_TOLERANCE_SECONDS
    }
}

pub enum Reading {
    Playing(MediaData),
    /// No app has an active media session.
    Nothing,
    /// The session exists but one read failed (common mid track change); keep the last state.
    Transient,
    Unavailable,
}

/// Matches `MediaCommand` in apps/desktop/src/providers/types.ts: `{ action, positionSec? }`.
#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case")]
pub enum MediaCommand {
    Toggle,
    Next,
    Previous,
    Seek {
        #[serde(rename = "positionSec")]
        position_sec: f64,
    },
}

/// What the reader does with one reading, given what the UI last heard.
#[derive(Debug, PartialEq)]
pub enum Update {
    /// The UI's state is out of date: send it this.
    Send(MediaData),
    /// The player closed: tell the UI there is no session (once).
    Idle,
    /// Nothing the UI does not already know.
    Keep,
    /// The session manager is missing on this system; it never appears later in a process.
    Stop,
}

/// The decision behind every event, kept free of Windows so it can be tested.
pub fn next_update(last_sent: Option<&MediaData>, idle_reported: bool, reading: Reading) -> Update {
    match reading {
        Reading::Playing(data) => {
            let changed = match last_sent {
                None => true,
                Some(last) => !last.same_track_state(&data) || last.clock_drifted(&data),
            };
            if changed || idle_reported {
                Update::Send(data)
            } else {
                Update::Keep
            }
        }
        Reading::Nothing if !idle_reported => Update::Idle,
        Reading::Nothing | Reading::Transient => Update::Keep,
        Reading::Unavailable => Update::Stop,
    }
}

/// The four transport calls of a session. A trait so the command path is testable without a player.
pub trait Transport {
    fn toggle(&self) -> windows::core::Result<bool>;
    fn next(&self) -> windows::core::Result<bool>;
    fn previous(&self) -> windows::core::Result<bool>;
    fn seek(&self, ticks: i64) -> windows::core::Result<bool>;
}

impl Transport for Session {
    fn toggle(&self) -> windows::core::Result<bool> {
        self.TryTogglePlayPauseAsync()?.join()
    }
    fn next(&self) -> windows::core::Result<bool> {
        self.TrySkipNextAsync()?.join()
    }
    fn previous(&self) -> windows::core::Result<bool> {
        self.TrySkipPreviousAsync()?.join()
    }
    fn seek(&self, ticks: i64) -> windows::core::Result<bool> {
        self.TryChangePlaybackPositionAsync(ticks)?.join()
    }
}

/// Runs one command on a session. True only when the player accepted it; the state change
/// itself reaches the UI through the session's next event.
pub fn dispatch(session: &impl Transport, command: MediaCommand) -> bool {
    let result = match command {
        MediaCommand::Toggle => session.toggle(),
        MediaCommand::Next => session.next(),
        MediaCommand::Previous => session.previous(),
        MediaCommand::Seek { position_sec } => {
            // Float-to-int `as` saturates, so out-of-range input cannot wrap.
            session.seek((position_sec.max(0.0) * TICKS_PER_SECOND) as i64)
        }
    };
    result.unwrap_or(false)
}

/// Event registrations on the current session, removed when it is replaced or the watch ends.
struct SessionTokens {
    session: Session,
    playback: i64,
    properties: i64,
    timeline: i64,
}

pub struct MediaProvider {
    manager: Option<Manager>,
    /// Cover art is re-read when the track changes, a few times until the app supplies it.
    artwork_for: Option<(String, String)>,
    artwork: Option<String>,
    artwork_attempts: u8,
    transient_attempts: u8,
    /// Set by `watch`: every media event sends on this, and the current session's events are followed.
    wake: Option<Sender<()>>,
    manager_token: Option<i64>,
    followed: Option<SessionTokens>,
}

fn unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

/// An event handler that only wakes the reader; the reader reads everything itself.
fn waker<S: windows::core::RuntimeType + 'static, A: windows::core::RuntimeType + 'static>(
    wake: &Sender<()>,
) -> TypedEventHandler<S, A> {
    let wake = wake.clone();
    TypedEventHandler::new(move |_, _| {
        // The reader only goes away at shutdown; nothing is left to wake then.
        let _ = wake.send(());
        Ok(())
    })
}

impl MediaProvider {
    pub fn new() -> Self {
        let manager = Manager::RequestAsync().and_then(|op| op.join()).ok();
        Self {
            manager,
            artwork_for: None,
            artwork: None,
            artwork_attempts: 0,
            transient_attempts: 0,
            wake: None,
            manager_token: None,
            followed: None,
        }
    }

    fn session(&self) -> Option<Session> {
        self.manager.as_ref()?.GetCurrentSession().ok()
    }

    /// From now on every media change sends on `wake`: a new current session, and the playback
    /// state, track and timeline of the current one.
    pub fn watch(&mut self, wake: Sender<()>) {
        if let Some(manager) = &self.manager {
            self.manager_token = manager.CurrentSessionChanged(&waker(&wake)).ok();
        }
        self.wake = Some(wake);
        self.follow_current_session();
    }

    /// Moves the session event registrations to the current session if it changed.
    fn follow_current_session(&mut self) {
        let Some(wake) = self.wake.clone() else { return };
        let current = self.session();
        if self.followed.as_ref().map(|f| &f.session) == current.as_ref() {
            return;
        }
        self.unfollow();
        let Some(session) = current else { return };
        let (Ok(playback), Ok(properties), Ok(timeline)) = (
            session.PlaybackInfoChanged(&waker(&wake)),
            session.MediaPropertiesChanged(&waker(&wake)),
            session.TimelinePropertiesChanged(&waker(&wake)),
        ) else {
            return;
        };
        self.followed = Some(SessionTokens { session, playback, properties, timeline });
    }

    fn unfollow(&mut self) {
        if let Some(f) = self.followed.take() {
            // A session whose app has exited can refuse; its registrations die with it.
            let _ = f.session.RemovePlaybackInfoChanged(f.playback);
            let _ = f.session.RemoveMediaPropertiesChanged(f.properties);
            let _ = f.session.RemoveTimelinePropertiesChanged(f.timeline);
        }
    }

    /// How soon to read again without an event: only while cover art or a failed read is pending.
    pub fn retry_after(&self, last: &Reading) -> Option<Duration> {
        let artwork_pending =
            matches!(last, Reading::Playing(d) if d.artwork.is_none()) && self.artwork_attempts < ARTWORK_ATTEMPTS;
        let transient_pending = matches!(last, Reading::Transient) && self.transient_attempts < TRANSIENT_ATTEMPTS;
        (artwork_pending || transient_pending).then_some(RETRY_AFTER)
    }

    pub fn read(&mut self) -> Reading {
        if self.manager.is_none() {
            return Reading::Unavailable;
        }
        self.follow_current_session();
        let Some(session) = self.session() else { return Reading::Nothing };
        match self.read_session(&session) {
            Ok(data) => {
                self.transient_attempts = 0;
                Reading::Playing(data)
            }
            Err(_) => {
                self.transient_attempts = self.transient_attempts.saturating_add(1);
                Reading::Transient
            }
        }
    }

    fn read_session(&mut self, session: &Session) -> windows::core::Result<MediaData> {
        let props = session.TryGetMediaPropertiesAsync()?.join()?;
        let title = props.Title()?.to_string_lossy();
        let artist = props.Artist()?.to_string_lossy();
        let album = props.AlbumTitle()?.to_string_lossy();
        let track = (title.clone(), artist.clone());
        if self.artwork_for.as_ref() != Some(&track) {
            self.artwork_for = Some(track);
            self.artwork = None;
            self.artwork_attempts = 0;
        }
        if self.artwork.is_none() && self.artwork_attempts < ARTWORK_ATTEMPTS {
            self.artwork_attempts += 1;
            self.artwork = props.Thumbnail().ok().and_then(|t| read_artwork(&t));
        }
        let timeline = session.GetTimelineProperties()?;
        let info = session.GetPlaybackInfo()?;
        let controls = info.Controls()?;
        let ticks = |t: windows::Foundation::TimeSpan| (t.Duration.max(0) as f64) / TICKS_PER_SECOND;
        let playing = info.PlaybackStatus()? == Status::Playing;
        // Anchor the clock to when the app last reported its position, not to now: apps that
        // update their timeline rarely would otherwise make the progress bar jump backwards.
        let updated_ms = (timeline.LastUpdatedTime()?.UniversalTime - UNIX_EPOCH_TICKS) / TICKS_PER_MS;
        let now = unix_ms();
        let reported = ticks(timeline.Position()?);
        let since_update = (now as i64 - updated_ms).max(0) as f64 / 1000.0;
        let position_seconds = if playing && updated_ms > 0 { reported + since_update } else { reported };
        Ok(MediaData {
            title,
            artist,
            album,
            artwork: self.artwork.clone(),
            position_seconds,
            duration_seconds: ticks(timeline.EndTime()?),
            sampled_at_ms: now,
            playing,
            can_seek: controls.IsPlaybackPositionEnabled()?,
            can_next: controls.IsNextEnabled()?,
            can_prev: controls.IsPreviousEnabled()?,
            can_play_pause: controls.IsPlayPauseToggleEnabled()?,
        })
    }

    /// Sends a transport command to the current session. Returns false if nothing handled it.
    pub fn command(&self, command: MediaCommand) -> bool {
        self.session().is_some_and(|session| dispatch(&session, command))
    }
}

impl Drop for MediaProvider {
    fn drop(&mut self) {
        self.unfollow();
        if let (Some(manager), Some(token)) = (&self.manager, self.manager_token.take()) {
            let _ = manager.RemoveCurrentSessionChanged(token);
        }
    }
}

impl Default for MediaProvider {
    fn default() -> Self {
        Self::new()
    }
}

fn read_artwork(reference: &windows::Storage::Streams::IRandomAccessStreamReference) -> Option<String> {
    let stream = reference.OpenReadAsync().ok()?.join().ok()?;
    let size = stream.Size().ok()?;
    if size == 0 || size > MAX_ARTWORK_BYTES {
        return None;
    }
    let len = u32::try_from(size).ok()?;
    let mime = stream.ContentType().map(|c| c.to_string_lossy()).unwrap_or_default();
    let mime = if mime.starts_with("image/") { mime } else { "image/png".to_owned() };
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    reader.LoadAsync(len).ok()?.join().ok()?;
    let mut bytes = vec![0u8; len as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:{mime};base64,{encoded}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> MediaData {
        MediaData {
            title: "Track".into(),
            artist: "Artist".into(),
            album: "Album".into(),
            artwork: None,
            position_seconds: 10.0,
            duration_seconds: 200.0,
            sampled_at_ms: 1,
            playing: true,
            can_seek: true,
            can_next: true,
            can_prev: true,
            can_play_pause: true,
        }
    }

    #[test]
    fn seeks_count_as_drift_but_normal_playback_does_not() {
        let a = MediaData { position_seconds: 10.0, sampled_at_ms: 1_000, ..sample() };
        let on_time = MediaData { position_seconds: 15.1, sampled_at_ms: 6_000, ..sample() };
        let seeked = MediaData { position_seconds: 90.0, sampled_at_ms: 6_000, ..sample() };
        assert!(!a.clock_drifted(&on_time));
        assert!(a.clock_drifted(&seeked));
    }

    #[test]
    fn command_json_matches_the_ui_contract() {
        let seek: MediaCommand = serde_json::from_str(r#"{"action":"seek","positionSec":42.5}"#).expect("seek parses");
        assert!(matches!(seek, MediaCommand::Seek { position_sec } if (position_sec - 42.5).abs() < f64::EPSILON));
        let toggle: MediaCommand = serde_json::from_str(r#"{"action":"toggle"}"#).expect("toggle parses");
        assert!(matches!(toggle, MediaCommand::Toggle));
        let json = serde_json::to_value(sample()).expect("serialises");
        assert!(json.get("positionSec").is_some() && json.get("durationSec").is_some());
    }

    #[test]
    fn events_send_only_what_the_ui_does_not_know() {
        let playing = sample();
        // First reading, and a pause, reach the UI.
        assert_eq!(next_update(None, false, Reading::Playing(playing.clone())), Update::Send(playing.clone()));
        let paused = MediaData { playing: false, ..sample() };
        assert_eq!(next_update(Some(&playing), false, Reading::Playing(paused.clone())), Update::Send(paused));
        // A timeline event that only confirms the clock is dropped.
        let on_time = MediaData { position_seconds: 15.0, sampled_at_ms: 5_001, ..sample() };
        assert_eq!(next_update(Some(&playing), false, Reading::Playing(on_time)), Update::Keep);
        // The player closes: idle once, then quiet; a new session after it is sent even if identical.
        assert_eq!(next_update(Some(&playing), false, Reading::Nothing), Update::Idle);
        assert_eq!(next_update(None, true, Reading::Nothing), Update::Keep);
        assert_eq!(next_update(Some(&playing), true, Reading::Playing(playing.clone())), Update::Send(playing.clone()));
        // A failed read keeps the last state; no session manager stops the reader.
        assert_eq!(next_update(Some(&playing), false, Reading::Transient), Update::Keep);
        assert_eq!(next_update(None, false, Reading::Unavailable), Update::Stop);
    }

    /// Records which transport call a command made.
    #[derive(Default)]
    struct FakeSession {
        calls: std::cell::RefCell<Vec<String>>,
        accepts: bool,
    }

    impl Transport for FakeSession {
        fn toggle(&self) -> windows::core::Result<bool> {
            self.calls.borrow_mut().push("toggle".into());
            Ok(self.accepts)
        }
        fn next(&self) -> windows::core::Result<bool> {
            self.calls.borrow_mut().push("next".into());
            Ok(self.accepts)
        }
        fn previous(&self) -> windows::core::Result<bool> {
            self.calls.borrow_mut().push("previous".into());
            Ok(self.accepts)
        }
        fn seek(&self, ticks: i64) -> windows::core::Result<bool> {
            self.calls.borrow_mut().push(format!("seek {ticks}"));
            Ok(self.accepts)
        }
    }

    #[test]
    fn each_command_calls_its_transport_method() {
        let session = FakeSession { accepts: true, ..FakeSession::default() };
        for json in [
            r#"{"action":"toggle"}"#,
            r#"{"action":"next"}"#,
            r#"{"action":"previous"}"#,
            r#"{"action":"seek","positionSec":1.5}"#,
            r#"{"action":"seek","positionSec":-3}"#,
        ] {
            let command: MediaCommand = serde_json::from_str(json).expect("command parses");
            assert!(dispatch(&session, command));
        }
        assert_eq!(*session.calls.borrow(), ["toggle", "next", "previous", "seek 15000000", "seek 0"]);
    }

    #[test]
    fn a_refused_command_reports_false() {
        let session = FakeSession::default();
        assert!(!dispatch(&session, MediaCommand::Toggle));
    }

    #[test]
    fn clock_changes_do_not_count_as_state_changes() {
        let a = sample();
        let b = MediaData { position_seconds: 42.0, sampled_at_ms: 99, ..sample() };
        assert!(a.same_track_state(&b));
        let c = MediaData { playing: false, ..sample() };
        assert!(!a.same_track_state(&c));
    }
}
