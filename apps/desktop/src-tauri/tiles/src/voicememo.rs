//! Voice memos: record the default microphone to a WAV file in Documents\dotDock Voice Memos, list and play them.
//!
//! Recording is event driven WASAPI capture: the thread sleeps until the audio engine has a packet, converts it to
//! 16-bit PCM and appends it to the file, so memory use does not grow with the length of the memo. The thread
//! exists only while recording, and Windows shows its microphone indicator for exactly that time. Playback uses
//! the system's `PlaySound`, which keeps the memo out of the media transport controls (no "now playing" entry).

use crate::clock::{file_stamp, now_ms};
use crate::com::ComGuard;
use crate::emit::{lock, Emitter};
use crate::protocol::{Memo, Playback, Recording, TileData, VoiceMemoState};
use crate::wav::{self, SampleFormat};
use crate::winloop::{wait_any, Event};
use std::fs::{self, File};
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use windows::core::{GUID, PCWSTR};
use windows::Win32::Media::Audio::{
    eCapture, IAudioCaptureClient, IAudioClient, IMMDevice, PlaySoundW, AUDCLNT_BUFFERFLAGS_SILENT,
    AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, SND_ASYNC, SND_FILENAME, SND_PURGE, WAVEFORMATEX,
    WAVEFORMATEXTENSIBLE,
};
use windows::Win32::System::Com::{CoTaskMemFree, CLSCTX_ALL};
use windows::Win32::UI::Shell::{
    SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FO_DELETE, SHFILEOPSTRUCTW,
};

/// Memos listed, newest first.
const LIST_LIMIT: usize = 50;
/// A memo ends by itself after this long; it is a memo, not a recorder.
const MAX_SECONDS: u64 = 60 * 60;
/// The recording level reaches the tile at most this often.
const LEVEL_EVERY: Duration = Duration::from_millis(66);
/// WAVE_FORMAT tags.
const FORMAT_PCM: u16 = 1;
const FORMAT_FLOAT: u16 = 3;
const FORMAT_EXTENSIBLE: u16 = 0xFFFE;
/// First field of the sub-format GUID for PCM and IEEE float (`KSDATAFORMAT_SUBTYPE_*`).
const SUBTYPE_PCM: u32 = 1;
const SUBTYPE_FLOAT: u32 = 3;

struct Capture {
    channels: u16,
    rate: u32,
    format: SampleFormat,
}

/// Reads the device's mix format; None for layouts we cannot convert.
unsafe fn read_format(fmt: *const WAVEFORMATEX) -> Option<Capture> {
    // SAFETY: caller passes the pointer from GetMixFormat; the struct is packed, so fields are read unaligned.
    unsafe {
        let tag = std::ptr::read_unaligned(&raw const (*fmt).wFormatTag);
        let channels = std::ptr::read_unaligned(&raw const (*fmt).nChannels);
        let rate = std::ptr::read_unaligned(&raw const (*fmt).nSamplesPerSec);
        let bits = std::ptr::read_unaligned(&raw const (*fmt).wBitsPerSample);
        let kind = match tag {
            FORMAT_PCM | FORMAT_FLOAT => tag,
            FORMAT_EXTENSIBLE => {
                let sub: GUID = std::ptr::read_unaligned(&raw const (*(fmt as *const WAVEFORMATEXTENSIBLE)).SubFormat);
                match sub.data1 {
                    SUBTYPE_PCM => FORMAT_PCM,
                    SUBTYPE_FLOAT => FORMAT_FLOAT,
                    _ => return None,
                }
            }
            _ => return None,
        };
        let format = match (kind, bits) {
            (FORMAT_FLOAT, 32) => SampleFormat::Float32,
            (FORMAT_PCM, 16) => SampleFormat::Int16,
            (FORMAT_PCM, 24) => SampleFormat::Int24,
            (FORMAT_PCM, 32) => SampleFormat::Int32,
            _ => return None,
        };
        Some(Capture { channels, rate, format })
    }
}

struct Recorder {
    stop: Arc<Event>,
    join: Option<JoinHandle<()>>,
}

impl Recorder {
    fn finish(&mut self) {
        self.stop.signal();
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
    }
}

pub struct VoiceMemo {
    folder: Option<PathBuf>,
    emitter: Emitter,
    state: Arc<Mutex<VoiceMemoState>>,
    recorder: Mutex<Option<Recorder>>,
    playback_stop: Mutex<Option<std::sync::mpsc::Sender<()>>>,
}

fn list(folder: &Path) -> Vec<Memo> {
    let Ok(read) = fs::read_dir(folder) else { return Vec::new() };
    let mut memos: Vec<Memo> = read
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("wav")))
        .filter_map(|entry| {
            let meta = entry.metadata().ok()?;
            let mut head = [0u8; wav::HEADER_LEN];
            File::open(entry.path()).ok()?.read_exact(&mut head).ok()?;
            let created_ms = meta
                .created()
                .or_else(|_| meta.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
                .unwrap_or(0);
            Some(Memo {
                path: entry.path().to_string_lossy().into_owned(),
                name: entry.path().file_stem()?.to_string_lossy().into_owned(),
                created_ms,
                duration_ms: wav::duration_ms(&head, meta.len())?,
                size_bytes: meta.len(),
            })
        })
        .collect();
    memos.sort_by(|a, b| b.created_ms.cmp(&a.created_ms).then_with(|| b.name.cmp(&a.name)));
    memos.truncate(LIST_LIMIT);
    memos
}

impl VoiceMemo {
    pub fn new(folder: Option<PathBuf>, emitter: Emitter) -> Self {
        let state = VoiceMemoState {
            folder: folder.as_ref().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default(),
            memos: folder.as_deref().map(list).unwrap_or_default(),
            recording: None,
            playing: None,
            problem: folder.is_none().then(|| "Windows did not say where Documents is".to_owned()),
        };
        Self {
            folder,
            emitter,
            state: Arc::new(Mutex::new(state)),
            recorder: Mutex::new(None),
            playback_stop: Mutex::new(None),
        }
    }

    pub fn state(&self) -> VoiceMemoState {
        lock(&self.state).clone()
    }

    fn publish(&self) {
        self.emitter.emit(TileData::VoiceMemo(self.state()));
    }

    /// Ends a recording and playback; the tile is no longer shown.
    pub fn stop(&self) {
        self.stop_recording();
        self.stop_playback();
    }

    pub fn start_recording(&self) -> Result<(), String> {
        let folder = self.folder.clone().ok_or("Windows did not say where Documents is")?;
        let mut slot = lock(&self.recorder);
        if slot.as_ref().is_some_and(|r| r.join.as_ref().is_some_and(|j| !j.is_finished())) {
            return Ok(());
        }
        self.stop_playback();
        fs::create_dir_all(&folder).map_err(|e| format!("could not create {}: {e}", folder.display()))?;
        let path = folder.join(format!("Voice memo {}.wav", file_stamp(now_ms())));
        let stop = Arc::new(Event::new()?);
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let (state, emitter, stop_for_thread, folder_for_thread) =
            (self.state.clone(), self.emitter.clone(), stop.clone(), folder.clone());
        let join = thread::Builder::new()
            .name("tiles-voice-memo".to_owned())
            .spawn(move || {
                let outcome = record(&path, &stop_for_thread, &ready_tx, &state, &emitter, &default_microphone);
                let mut s = lock(&state);
                s.recording = None;
                match outcome {
                    Ok(()) => {
                        s.memos = list(&folder_for_thread);
                        s.problem = None;
                    }
                    Err(e) => {
                        // A failed recording leaves no empty file behind.
                        let _ = fs::remove_file(&path);
                        s.problem = Some(e.clone());
                        // `start_recording` is still waiting only if the failure came before the first packet.
                        let _ = ready_tx.send(Err(e));
                    }
                }
                let snapshot = s.clone();
                drop(s);
                emitter.emit(TileData::VoiceMemo(snapshot));
            })
            .map_err(|e| format!("could not start recording: {e}"))?;
        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => {
                *slot = Some(Recorder { stop, join: Some(join) });
                drop(slot);
                self.publish();
                Ok(())
            }
            Ok(Err(e)) => {
                let _ = join.join();
                Err(e)
            }
            Err(_) => {
                stop.signal();
                let _ = join.join();
                Err("The microphone did not start in time".to_owned())
            }
        }
    }

    pub fn stop_recording(&self) {
        let recorder = lock(&self.recorder).take();
        if let Some(mut r) = recorder {
            r.finish();
        }
    }

    pub fn play(&self, path: &str) -> Result<(), String> {
        let memo = lock(&self.state)
            .memos
            .iter()
            .find(|m| m.path.eq_ignore_ascii_case(path))
            .cloned()
            .ok_or("That memo is not in the list")?;
        self.stop_playback();
        let wide = crate::com::wide(&memo.path);
        // SAFETY: the path is NUL-terminated; SND_ASYNC returns at once and Windows reads the file itself.
        if !unsafe { PlaySoundW(PCWSTR(wide.as_ptr()), None, SND_FILENAME | SND_ASYNC) }.as_bool() {
            return Err("Windows could not play that memo".to_owned());
        }
        lock(&self.state).playing =
            Some(Playback { path: memo.path.clone(), started_ms: now_ms(), duration_ms: memo.duration_ms });
        self.publish();
        // One short-lived timer thread ends the "playing" state when the memo is over.
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        *lock(&self.playback_stop) = Some(tx);
        let (state, emitter, name) = (self.state.clone(), self.emitter.clone(), memo.path);
        let wait = Duration::from_millis(memo.duration_ms + 200);
        let _ = thread::Builder::new().name("tiles-memo-playback".to_owned()).spawn(move || {
            if rx.recv_timeout(wait).is_err() {
                let mut s = lock(&state);
                if s.playing.as_ref().is_some_and(|p| p.path == name) {
                    s.playing = None;
                    let snapshot = s.clone();
                    drop(s);
                    emitter.emit(TileData::VoiceMemo(snapshot));
                }
            }
        });
        Ok(())
    }

    pub fn stop_playback(&self) {
        if let Some(tx) = lock(&self.playback_stop).take() {
            let _ = tx.send(());
        }
        let was_playing = lock(&self.state).playing.take().is_some();
        if was_playing {
            // SAFETY: SND_PURGE with a null sound stops what this process is playing.
            let _ = unsafe { PlaySoundW(PCWSTR::null(), None, SND_PURGE) };
            self.publish();
        }
    }

    /// Moves a memo to the Recycle Bin.
    pub fn delete(&self, path: &str) -> Result<(), String> {
        let memo = lock(&self.state)
            .memos
            .iter()
            .find(|m| m.path.eq_ignore_ascii_case(path))
            .cloned()
            .ok_or("That memo is not in the list")?;
        if lock(&self.state).playing.as_ref().is_some_and(|p| p.path == memo.path) {
            self.stop_playback();
        }
        let mut from: Vec<u16> = memo.path.encode_utf16().collect();
        from.extend([0, 0]);
        let mut op = SHFILEOPSTRUCTW {
            wFunc: FO_DELETE,
            pFrom: PCWSTR(from.as_ptr()),
            fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT).0 as u16,
            ..Default::default()
        };
        // SAFETY: pFrom is a double-NUL-terminated list that outlives the call.
        if unsafe { SHFileOperationW(&mut op) } != 0 || op.fAnyOperationsAborted.as_bool() {
            return Err("Windows could not move the memo to the Recycle Bin".to_owned());
        }
        if let Some(folder) = &self.folder {
            lock(&self.state).memos = list(folder);
        }
        self.publish();
        Ok(())
    }
}

/// The default microphone, opened as a normal capture stream.
fn default_microphone() -> Result<(IMMDevice, u32), String> {
    crate::audio::devices::default_device(eCapture).map(|d| (d, 0)).map_err(|_| "No microphone is connected".to_owned())
}

/// Runs one recording until `stop` is signalled, the memo is an hour long, or the device fails.
fn record(
    path: &Path,
    stop: &Event,
    ready: &std::sync::mpsc::Sender<Result<(), String>>,
    state: &Arc<Mutex<VoiceMemoState>>,
    emitter: &Emitter,
    source: &dyn Fn() -> Result<(IMMDevice, u32), String>,
) -> Result<(), String> {
    let _com = ComGuard::new();
    let (device, source_flags) = source()?;
    // SAFETY: standard WASAPI shared-mode capture; every interface is released on drop, the mix format is freed,
    // and the stream is stopped before the file is finalised.
    unsafe {
        let client = device.Activate::<IAudioClient>(CLSCTX_ALL, None).map_err(|e| format!("microphone: {e}"))?;
        let mix = client.GetMixFormat().map_err(|e| format!("microphone format: {e}"))?;
        let capture = read_format(mix);
        let Some(capture) = capture else {
            CoTaskMemFree(Some(mix.cast_const().cast()));
            return Err("This microphone uses a sample format voice memos cannot record".to_owned());
        };
        let init = client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_EVENTCALLBACK | source_flags,
            0,
            0,
            mix,
            None,
        );
        CoTaskMemFree(Some(mix.cast_const().cast()));
        init.map_err(|e| {
            format!("Windows would not open the microphone ({e}). Check Settings > Privacy > Microphone.")
        })?;
        let arrived = Event::new()?;
        client.SetEventHandle(arrived.handle()).map_err(|e| format!("microphone events: {e}"))?;
        let reader = client.GetService::<IAudioCaptureClient>().map_err(|e| format!("microphone reader: {e}"))?;

        let mut out = BufWriter::new(File::create(path).map_err(|e| format!("could not create the memo: {e}"))?);
        out.write_all(&wav::header(capture.channels, capture.rate, 0))
            .map_err(|e| format!("could not write the memo: {e}"))?;
        client.Start().map_err(|e| format!("microphone start: {e}"))?;
        let _ = ready.send(Ok(()));
        let started = now_ms();
        lock(state).recording = Some(Recording { started_ms: started, peak: 0.0 });

        let bytes_per_frame = usize::from(capture.channels) * capture.format.bytes_per_sample();
        let limit_bytes = MAX_SECONDS * u64::from(capture.rate) * u64::from(capture.channels) * 2;
        let mut data_len = 0u64;
        let mut last_level = std::time::Instant::now();
        let mut interval_peak = 0.0f32;
        let outcome: Result<(), String> = loop {
            match wait_any(&[stop.handle(), arrived.handle()]) {
                Some(1) => {}
                _ => break Ok(()),
            }
            loop {
                let frames = reader.GetNextPacketSize().map_err(|e| format!("microphone read: {e}"))?;
                if frames == 0 {
                    break;
                }
                let (mut data, mut got, mut flags) = (std::ptr::null_mut(), 0u32, 0u32);
                reader
                    .GetBuffer(&mut data, &mut got, &mut flags, None, None)
                    .map_err(|e| format!("microphone read: {e}"))?;
                let samples = if flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data.is_null() {
                    (vec![0i16; got as usize * usize::from(capture.channels)], 0.0)
                } else {
                    wav::to_pcm16(std::slice::from_raw_parts(data, got as usize * bytes_per_frame), capture.format)
                };
                reader.ReleaseBuffer(got).map_err(|e| format!("microphone read: {e}"))?;
                let bytes: Vec<u8> = samples.0.iter().flat_map(|s| s.to_le_bytes()).collect();
                out.write_all(&bytes).map_err(|e| format!("could not write the memo: {e}"))?;
                data_len += bytes.len() as u64;
                interval_peak = interval_peak.max(samples.1);
            }
            if last_level.elapsed() >= LEVEL_EVERY {
                last_level = std::time::Instant::now();
                let snapshot = {
                    let mut s = lock(state);
                    s.recording = Some(Recording { started_ms: started, peak: interval_peak });
                    s.clone()
                };
                interval_peak = 0.0;
                emitter.emit(TileData::VoiceMemo(snapshot));
            }
            if data_len >= limit_bytes {
                break Ok(());
            }
        };
        let _ = client.Stop();
        outcome?;
        // Fill in the real length now that it is known.
        out.flush().map_err(|e| format!("could not write the memo: {e}"))?;
        let mut file = out.into_inner().map_err(|e| format!("could not write the memo: {e}"))?;
        let len = u32::try_from(data_len).map_err(|_| "The memo is too long".to_owned())?;
        file.seek(SeekFrom::Start(0))
            .and_then(|_| file.write_all(&wav::header(capture.channels, capture.rate, len)))
            .and_then(|()| file.sync_all())
            .map_err(|e| format!("could not finish the memo: {e}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_list_shows_only_readable_wav_files_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        for (name, secs) in [("Voice memo a.wav", 1u32), ("Voice memo b.wav", 2)] {
            let data_len = 16_000 * 2 * secs;
            let mut bytes = wav::header(1, 16_000, data_len).to_vec();
            bytes.extend(vec![0u8; data_len as usize]);
            fs::write(dir.path().join(name), bytes).unwrap();
            std::thread::sleep(Duration::from_millis(20));
        }
        fs::write(dir.path().join("notes.txt"), b"x").unwrap();
        fs::write(dir.path().join("broken.wav"), b"RIFF").unwrap();
        let memos = list(dir.path());
        assert_eq!(memos.len(), 2);
        assert_eq!(memos[0].name, "Voice memo b");
        assert_eq!(memos[0].duration_ms, 2000);
        assert_eq!(memos[1].duration_ms, 1000);
    }

    /// The capture path end to end on real audio. The speakers' loopback stands in for the microphone, because
    /// Windows can block microphone access machine-wide; everything after the device is opened (format conversion,
    /// streaming to disk, the WAV header, levels) is the production code. Audible, so it runs on request.
    #[test]
    #[ignore = "plays a short system sound on the speakers; run with --ignored"]
    fn recording_real_audio_writes_a_valid_wav() {
        use windows::Win32::Media::Audio::{eRender, AUDCLNT_STREAMFLAGS_LOOPBACK};
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("loopback.wav");
        let levels = Arc::new(Mutex::new(Vec::new()));
        let seen = levels.clone();
        let emitter = Emitter::new(move |d| {
            if let TileData::VoiceMemo(s) = d {
                if let Some(r) = s.recording {
                    lock(&seen).push(r.peak);
                }
            }
        });
        let state = Arc::new(Mutex::new(VoiceMemoState {
            folder: String::new(),
            memos: vec![],
            recording: None,
            playing: None,
            problem: None,
        }));
        let stop = Arc::new(Event::new().unwrap());
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let (p, s, st) = (path.clone(), stop.clone(), state.clone());
        let worker = thread::spawn(move || {
            let source = || crate::audio::devices::default_device(eRender).map(|d| (d, AUDCLNT_STREAMFLAGS_LOOPBACK));
            record(&p, &s, &ready_tx, &st, &emitter, &source)
        });
        assert!(ready_rx.recv_timeout(Duration::from_secs(5)).unwrap().is_ok(), "the capture stream opens");
        let mut speakers = crate::audible::Speakers::take();
        let waited = std::time::Instant::now();
        while !lock(&levels).iter().any(|p| *p > 0.0) && waited.elapsed() < crate::audible::HEAR_WITHIN {
            thread::sleep(LEVEL_EVERY);
            speakers.keep_playing();
        }
        drop(speakers);
        stop.signal();
        worker.join().unwrap().expect("the recording finishes cleanly");
        let bytes = fs::read(&path).unwrap();
        let duration = wav::duration_ms(&bytes[..wav::HEADER_LEN], bytes.len() as u64).expect("a valid WAV header");
        assert!(duration > 0 && duration < 15_000, "duration {duration} ms");
        let loudest = bytes[wav::HEADER_LEN..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| i16::from_le_bytes([c[0], c[1]]).unsigned_abs())
            .max()
            .unwrap_or(0);
        assert!(loudest > 0, "the sound reached the file ({} bytes)", bytes.len());
        assert!(lock(&levels).iter().any(|p| *p > 0.0), "level events carried the sound");
    }

    #[test]
    fn a_missing_folder_lists_nothing() {
        assert!(list(Path::new(r"C:\no\such\memos")).is_empty());
    }

    #[test]
    fn unknown_memos_cannot_be_played_or_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let v = VoiceMemo::new(Some(dir.path().to_path_buf()), Emitter::new(|_| {}));
        assert!(v.play(r"C:\Windows\notepad.exe").is_err());
        assert!(v.delete(r"C:\Windows\notepad.exe").is_err());
    }
}
