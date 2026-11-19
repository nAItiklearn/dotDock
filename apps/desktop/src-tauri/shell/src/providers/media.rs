//! Now-playing data and transport controls from Windows' system media session
//! (the same source as the volume-flyout media card). Works with any app that
//! publishes a media session: Spotify, browsers, media players.

use base64::Engine;
use serde::Serialize;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Storage::Streams::DataReader;

/// WinRT TimeSpan ticks are 100 ns.
const TICKS_PER_SECOND: f64 = 10_000_000.0;
/// Artwork bigger than this is skipped rather than shipped over IPC.
const MAX_ARTWORK_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MediaData {
    pub title: String,
    pub artist: String,
    pub album: String,
    /// `data:` URL of the cover image, or None when the app supplies none.
    pub artwork: Option<String>,
    pub position_seconds: f64,
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
}

pub enum Reading {
    Playing(MediaData),
    /// No app has an active media session.
    Nothing,
    Unavailable,
}

#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MediaCommand {
    PlayPause,
    Next,
    Previous,
}

pub struct MediaProvider {
    manager: Option<Manager>,
    /// Cover art is only re-read when the track changes.
    artwork_for: Option<(String, String)>,
    artwork: Option<String>,
}

fn unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

impl MediaProvider {
    pub fn new() -> Self {
        let manager = Manager::RequestAsync().and_then(|op| op.join()).ok();
        Self { manager, artwork_for: None, artwork: None }
    }

    fn session(&self) -> Option<Session> {
        self.manager.as_ref()?.GetCurrentSession().ok()
    }

    pub fn read(&mut self) -> Reading {
        if self.manager.is_none() {
            return Reading::Unavailable;
        }
        let Some(session) = self.session() else { return Reading::Nothing };
        match self.read_session(&session) {
            Ok(data) => Reading::Playing(data),
            Err(_) => Reading::Nothing,
        }
    }

    fn read_session(&mut self, session: &Session) -> windows::core::Result<MediaData> {
        let props = session.TryGetMediaPropertiesAsync()?.join()?;
        let title = props.Title()?.to_string_lossy();
        let artist = props.Artist()?.to_string_lossy();
        let album = props.AlbumTitle()?.to_string_lossy();
        let track = (title.clone(), artist.clone());
        if self.artwork_for.as_ref() != Some(&track) {
            self.artwork = props.Thumbnail().ok().and_then(|t| read_artwork(&t));
            self.artwork_for = Some(track);
        }
        let timeline = session.GetTimelineProperties()?;
        let info = session.GetPlaybackInfo()?;
        let controls = info.Controls()?;
        let ticks = |t: windows::Foundation::TimeSpan| (t.Duration.max(0) as f64) / TICKS_PER_SECOND;
        Ok(MediaData {
            title,
            artist,
            album,
            artwork: self.artwork.clone(),
            position_seconds: ticks(timeline.Position()?),
            duration_seconds: ticks(timeline.EndTime()?),
            sampled_at_ms: unix_ms(),
            playing: info.PlaybackStatus()? == Status::Playing,
            can_seek: controls.IsPlaybackPositionEnabled()?,
            can_next: controls.IsNextEnabled()?,
            can_prev: controls.IsPreviousEnabled()?,
            can_play_pause: controls.IsPlayPauseToggleEnabled()?,
        })
    }

    /// Sends a transport command to the current session. Returns false if nothing handled it.
    pub fn command(&self, command: MediaCommand) -> bool {
        let Some(session) = self.session() else { return false };
        let op = match command {
            MediaCommand::PlayPause => session.TryTogglePlayPauseAsync(),
            MediaCommand::Next => session.TrySkipNextAsync(),
            MediaCommand::Previous => session.TrySkipPreviousAsync(),
        };
        op.and_then(|op| op.join()).unwrap_or(false)
    }

    pub fn seek(&self, seconds: f64) -> bool {
        let Some(session) = self.session() else { return false };
        // Float-to-int `as` saturates, so out-of-range input cannot wrap.
        let ticks = (seconds.max(0.0) * TICKS_PER_SECOND) as i64;
        session.TryChangePlaybackPositionAsync(ticks).and_then(|op| op.join()).unwrap_or(false)
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
    fn clock_changes_do_not_count_as_state_changes() {
        let a = sample();
        let b = MediaData { position_seconds: 42.0, sampled_at_ms: 99, ..sample() };
        assert!(a.same_track_state(&b));
        let c = MediaData { playing: false, ..sample() };
        assert!(!a.same_track_state(&c));
    }
}
