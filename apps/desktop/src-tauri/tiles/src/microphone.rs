//! The default microphone: mute (event driven) and a live input level (sampled only while someone watches).
//!
//! Mute and volume follow Core Audio notifications, so a change made in Windows settings or a headset button
//! reaches the tile at once. The level needs an open capture stream (Windows only runs the capture engine for an
//! endpoint while a stream exists), so it is a separate subscription, `microphone-level`: the stream is open only
//! while that tile is on screen and the microphone is not muted, and Windows shows its own "microphone in use"
//! indicator for exactly that time.

use crate::audio::devices;
use crate::audio::{DeviceEvents, Poke, Refresh, VolumeEvents};
use crate::com::{coalesce, ComGuard, Worker};
use crate::emit::{lock, shared, Emitter, Shared};
use crate::protocol::{MicrophoneLevel, MicrophoneState, TileData};
use std::sync::Mutex;
use std::time::Duration;
use windows::Win32::Media::Audio::Endpoints::{
    IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioMeterInformation,
};
use windows::Win32::Media::Audio::{eCapture, IAudioClient, IMMNotificationClient, AUDCLNT_SHAREMODE_SHARED};
use windows::Win32::System::Com::{CoTaskMemFree, CLSCTX_ALL};

const COALESCE: Duration = Duration::from_millis(8);
const START_TIMEOUT: Duration = Duration::from_secs(3);
/// Level sampling rate while the tile is visible: about 30 Hz is smooth for a ring and cheap.
const LEVEL_INTERVAL: Duration = Duration::from_millis(33);
/// WASAPI buffer length for the metering stream, in 100 ns units (100 ms). Nothing is read from it.
const METER_BUFFER_HNS: i64 = 1_000_000;
/// A change in peak smaller than this is not worth an event.
const LEVEL_EPSILON: f32 = 0.01;

struct Binding {
    volume: IAudioEndpointVolume,
    events: IAudioEndpointVolumeCallback,
    device_id: String,
    name: String,
}

impl Binding {
    fn new(poke: &Poke) -> Result<Self, String> {
        let device = devices::default_device(eCapture)?;
        let volume = devices::endpoint_volume(&device)?;
        let events: IAudioEndpointVolumeCallback = VolumeEvents(poke.clone()).into();
        // SAFETY: unregistered in Drop before the callback is released.
        unsafe { volume.RegisterControlChangeNotify(&events) }.map_err(|e| format!("microphone notifications: {e}"))?;
        let info = devices::describe(&device, eCapture);
        Ok(Self { volume, events, device_id: info.id, name: info.name })
    }
}

impl Drop for Binding {
    fn drop(&mut self) {
        // SAFETY: undoes the registration in `new`.
        let _ = unsafe { self.volume.UnregisterControlChangeNotify(&self.events) };
    }
}

fn compose(binding: Option<&Binding>) -> MicrophoneState {
    match binding {
        Some(b) => {
            let (volume, muted) = devices::read_volume(&b.volume);
            MicrophoneState { available: true, device_name: Some(b.name.clone()), muted, volume }
        }
        None => MicrophoneState { available: false, device_name: None, muted: false, volume: 0.0 },
    }
}

pub fn read_once() -> MicrophoneState {
    let binding = devices::default_device(eCapture).ok().and_then(|d| {
        let volume = devices::endpoint_volume(&d).ok()?;
        let info = devices::describe(&d, eCapture);
        Some((volume, info))
    });
    match binding {
        Some((volume, info)) => {
            let (volume, muted) = devices::read_volume(&volume);
            MicrophoneState { available: true, device_name: Some(info.name), muted, volume }
        }
        None => compose(None),
    }
}

pub fn set_muted(muted: bool) -> Result<(), String> {
    let volume = devices::endpoint_volume(&devices::default_device(eCapture)?)?;
    // SAFETY: plain setter on a live interface; null event context.
    unsafe { volume.SetMute(muted, std::ptr::null()) }.map_err(|e| format!("could not change microphone mute: {e}"))
}

pub struct Microphone {
    emitter: Emitter,
    state: Shared<Option<MicrophoneState>>,
    worker: Mutex<Option<Worker<Refresh>>>,
}

impl Microphone {
    pub fn new(emitter: Emitter) -> Self {
        Self { emitter, state: shared(None), worker: Mutex::new(None) }
    }

    pub fn start(&self) -> Result<(), String> {
        let mut slot = lock(&self.worker);
        if slot.is_some() {
            return Ok(());
        }
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let state = self.state.clone();
        let emitter = self.emitter.clone();
        let worker = Worker::spawn("tiles-microphone", move |rx, tx| {
            let _com = ComGuard::new();
            let poke = Poke::new(tx);
            let client: IMMNotificationClient = DeviceEvents(poke.clone()).into();
            let enumerator = devices::enumerator();
            if let Ok(e) = &enumerator {
                // SAFETY: unregistered before the worker ends.
                let _ = unsafe { e.RegisterEndpointNotificationCallback(&client) };
            }
            let mut binding: Option<Binding> = None;
            let refresh = |binding: &mut Option<Binding>| {
                let default_id = devices::default_device(eCapture).map(|d| devices::device_id(&d)).ok();
                let stale = match (&*binding, &default_id) {
                    (Some(b), Some(id)) => &b.device_id != id,
                    (None, None) => false,
                    _ => true,
                };
                if stale {
                    *binding = default_id.and_then(|_| Binding::new(&poke).ok());
                }
                let next = compose(binding.as_ref());
                if lock(&state).as_ref() != Some(&next) {
                    *lock(&state) = Some(next.clone());
                    emitter.emit(TileData::Microphone(next));
                }
            };
            refresh(&mut binding);
            let _ = ready_tx.send(());
            while let Ok(Some(_)) = rx.recv() {
                if !coalesce(&rx, COALESCE) {
                    break;
                }
                refresh(&mut binding);
            }
            drop(binding);
            if let Ok(e) = &enumerator {
                // SAFETY: undoes the registration above.
                let _ = unsafe { e.UnregisterEndpointNotificationCallback(&client) };
            }
        })
        .map_err(|e| format!("could not start the microphone worker: {e}"))?;
        *slot = Some(worker);
        drop(slot);
        let _ = ready_rx.recv_timeout(START_TIMEOUT);
        Ok(())
    }

    pub fn stop(&self) {
        let worker = lock(&self.worker).take();
        drop(worker);
        *lock(&self.state) = None;
    }

    pub fn state(&self) -> MicrophoneState {
        lock(&self.state).clone().unwrap_or_else(read_once)
    }
}

/// An open capture stream on the default microphone, read only through the endpoint's peak meter.
struct Meter {
    client: IAudioClient,
    meter: IAudioMeterInformation,
}

impl Meter {
    fn open() -> Result<Self, String> {
        Self::open_on(&devices::default_device(eCapture)?, 0)
    }

    /// Opens a metering stream on `device` with extra stream flags (none for a microphone).
    fn open_on(device: &windows::Win32::Media::Audio::IMMDevice, flags: u32) -> Result<Self, String> {
        // SAFETY: activation returns owned interfaces; the mix format is CoTaskMem memory freed below; the stream
        // is stopped in Drop.
        unsafe {
            let client =
                device.Activate::<IAudioClient>(CLSCTX_ALL, None).map_err(|e| format!("microphone stream: {e}"))?;
            let format = client.GetMixFormat().map_err(|e| format!("microphone format: {e}"))?;
            let init = client.Initialize(AUDCLNT_SHAREMODE_SHARED, flags, METER_BUFFER_HNS, 0, format, None);
            CoTaskMemFree(Some(format.cast_const().cast()));
            init.map_err(|e| {
                format!("Windows would not open the microphone ({e}). Check Settings > Privacy > Microphone.")
            })?;
            client.Start().map_err(|e| format!("microphone start: {e}"))?;
            let meter = device
                .Activate::<IAudioMeterInformation>(CLSCTX_ALL, None)
                .map_err(|e| format!("microphone meter: {e}"))?;
            Ok(Self { client, meter })
        }
    }

    fn peak(&self) -> f32 {
        // SAFETY: plain getter.
        unsafe { self.meter.GetPeakValue() }.unwrap_or(0.0).clamp(0.0, 1.0)
    }
}

impl Drop for Meter {
    fn drop(&mut self) {
        // SAFETY: stops the stream started in `open`.
        let _ = unsafe { self.client.Stop() };
    }
}

/// Live input level. Subscribed only while the tile is visible.
pub struct MicrophoneLevelProvider {
    emitter: Emitter,
    last: Shared<Option<MicrophoneLevel>>,
    worker: Mutex<Option<Worker<Refresh>>>,
}

impl MicrophoneLevelProvider {
    pub fn new(emitter: Emitter) -> Self {
        Self { emitter, last: shared(None), worker: Mutex::new(None) }
    }

    pub fn start(&self) -> Result<(), String> {
        let mut slot = lock(&self.worker);
        if slot.is_some() {
            return Ok(());
        }
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let last = self.last.clone();
        let emitter = self.emitter.clone();
        let worker = Worker::spawn("tiles-mic-level", move |rx, tx| {
            let _com = ComGuard::new();
            let poke = Poke::new(tx);
            let client: IMMNotificationClient = DeviceEvents(poke.clone()).into();
            let enumerator = devices::enumerator();
            if let Ok(e) = &enumerator {
                // SAFETY: unregistered before the worker ends.
                let _ = unsafe { e.RegisterEndpointNotificationCallback(&client) };
            }
            let mut binding = Binding::new(&poke).ok();
            let mut meter: Option<Meter> = None;
            let mut problem: Option<String> = None;
            let publish = |level: MicrophoneLevel, force: bool| {
                let mut slot = lock(&last);
                let changed = match slot.as_ref() {
                    Some(prev) => {
                        prev.listening != level.listening
                            || prev.problem != level.problem
                            || (prev.peak - level.peak).abs() >= LEVEL_EPSILON
                            || (level.peak == 0.0 && prev.peak != 0.0)
                    }
                    None => true,
                };
                if changed || force {
                    *slot = Some(level.clone());
                    drop(slot);
                    emitter.emit(TileData::MicrophoneLevel(level));
                }
            };
            let mut ready = Some(ready_tx);
            loop {
                // Keep the stream open exactly while there is a microphone that is not muted.
                let muted = binding.as_ref().map(|b| devices::read_volume(&b.volume).1).unwrap_or(true);
                if muted || binding.is_none() {
                    meter = None;
                } else if meter.is_none() {
                    match Meter::open() {
                        Ok(m) => {
                            meter = Some(m);
                            problem = None;
                        }
                        Err(e) => problem = Some(e),
                    }
                }
                match &meter {
                    Some(m) => publish(MicrophoneLevel { peak: m.peak(), listening: true, problem: None }, false),
                    None => publish(MicrophoneLevel { peak: 0.0, listening: false, problem: problem.clone() }, false),
                }
                if let Some(tx) = ready.take() {
                    let _ = tx.send(());
                }
                let message = if meter.is_some() {
                    rx.recv_timeout(LEVEL_INTERVAL)
                } else {
                    rx.recv().map_err(|_| std::sync::mpsc::RecvTimeoutError::Disconnected)
                };
                match message {
                    Ok(Some(_)) => {
                        if !coalesce(&rx, COALESCE) {
                            break;
                        }
                        // The default device or its mute flag changed: look again.
                        let default_id = devices::default_device(eCapture).map(|d| devices::device_id(&d)).ok();
                        let stale = binding
                            .as_ref()
                            .map(|b| Some(&b.device_id) != default_id.as_ref())
                            .unwrap_or(default_id.is_some());
                        if stale {
                            meter = None;
                            binding = Binding::new(&poke).ok();
                        }
                    }
                    Ok(None) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                }
            }
            drop(meter);
            drop(binding);
            if let Ok(e) = &enumerator {
                // SAFETY: undoes the registration above.
                let _ = unsafe { e.UnregisterEndpointNotificationCallback(&client) };
            }
        })
        .map_err(|e| format!("could not start the microphone level worker: {e}"))?;
        *slot = Some(worker);
        drop(slot);
        let _ = ready_rx.recv_timeout(START_TIMEOUT);
        Ok(())
    }

    pub fn stop(&self) {
        let worker = lock(&self.worker).take();
        drop(worker);
        *lock(&self.last) = None;
    }

    pub fn state(&self) -> MicrophoneLevel {
        lock(&self.last).clone().unwrap_or(MicrophoneLevel { peak: 0.0, listening: false, problem: None })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reading_without_a_provider_does_not_panic() {
        let _ = read_once();
    }

    /// The level meter on real audio. The speakers' loopback stands in for the microphone, which Windows can
    /// block machine-wide; the stream and the meter are the production code. Audible, so it runs on request.
    #[test]
    #[ignore = "plays a short system sound on the speakers; run with --ignored"]
    fn the_meter_follows_real_sound() {
        use windows::Win32::Media::Audio::{eRender, AUDCLNT_STREAMFLAGS_LOOPBACK};
        crate::com::ensure();
        let device = devices::default_device(eRender).expect("the speakers exist");
        let meter = Meter::open_on(&device, AUDCLNT_STREAMFLAGS_LOOPBACK).expect("the stream opens");
        let mut speakers = crate::audible::Speakers::take();
        let heard = std::time::Instant::now();
        let mut peak = 0.0f32;
        while peak == 0.0 && heard.elapsed() < crate::audible::HEAR_WITHIN {
            std::thread::sleep(LEVEL_INTERVAL);
            peak = meter.peak();
            speakers.keep_playing();
        }
        assert!(peak > 0.0, "the meter saw the sound");
    }
}
