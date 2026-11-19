//! Playback audio: the default output's volume and mute, the device list and the switch, per-app volume.
//!
//! Event driven: while subscribed, one worker thread sleeps until Core Audio calls one of its notification
//! callbacks (endpoint volume, default device, device list, session created, session volume or state), then
//! reads the whole state once and pushes it if it changed. Nothing runs when nobody is subscribed.

pub mod devices;
mod policy;
pub mod sessions;

use crate::appname::NameCache;
use crate::com::{coalesce, ComGuard, Worker};
use crate::emit::{lock, shared, Emitter, Shared};
use crate::protocol::{AudioState, TileData};
use std::collections::HashMap;
use std::sync::mpsc::Sender;
use std::sync::Mutex;
use std::time::Duration;
use windows::core::BOOL;
use windows::core::{implement, Ref, PCWSTR};
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::Media::Audio::Endpoints::{
    IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl,
};
use windows::Win32::Media::Audio::{
    eRender, AudioSessionDisconnectReason, AudioSessionState, EDataFlow, ERole, IAudioSessionControl,
    IAudioSessionEvents, IAudioSessionEvents_Impl, IAudioSessionManager2, IAudioSessionNotification,
    IAudioSessionNotification_Impl, IMMDeviceEnumerator, IMMNotificationClient, IMMNotificationClient_Impl,
    AUDIO_VOLUME_NOTIFICATION_DATA, DEVICE_STATE,
};

/// Bursts of notifications (a volume drag fires dozens) are folded into one refresh within this window.
const COALESCE: Duration = Duration::from_millis(8);
/// How long `start` waits for the worker's first reading.
const START_TIMEOUT: Duration = Duration::from_secs(3);

pub(crate) struct Refresh;

#[derive(Clone)]
pub(crate) struct Poke(pub(crate) Sender<Option<Refresh>>);

impl Poke {
    fn poke(&self) {
        // The worker is gone only while shutting down; a lost poke then does not matter.
        let _ = self.0.send(Some(Refresh));
    }
}

#[implement(IMMNotificationClient)]
pub(crate) struct DeviceEvents(pub(crate) Poke);

impl IMMNotificationClient_Impl for DeviceEvents_Impl {
    fn OnDeviceStateChanged(&self, _: &PCWSTR, _: DEVICE_STATE) -> windows::core::Result<()> {
        self.0.poke();
        Ok(())
    }
    fn OnDeviceAdded(&self, _: &PCWSTR) -> windows::core::Result<()> {
        self.0.poke();
        Ok(())
    }
    fn OnDeviceRemoved(&self, _: &PCWSTR) -> windows::core::Result<()> {
        self.0.poke();
        Ok(())
    }
    fn OnDefaultDeviceChanged(&self, _: EDataFlow, _: ERole, _: &PCWSTR) -> windows::core::Result<()> {
        self.0.poke();
        Ok(())
    }
    fn OnPropertyValueChanged(&self, _: &PCWSTR, _: &PROPERTYKEY) -> windows::core::Result<()> {
        Ok(())
    }
}

#[implement(IAudioEndpointVolumeCallback)]
pub(crate) struct VolumeEvents(pub(crate) Poke);

impl IAudioEndpointVolumeCallback_Impl for VolumeEvents_Impl {
    fn OnNotify(&self, _: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> windows::core::Result<()> {
        self.0.poke();
        Ok(())
    }
}

#[implement(IAudioSessionNotification)]
struct NewSession(Poke);

impl IAudioSessionNotification_Impl for NewSession_Impl {
    fn OnSessionCreated(&self, _: Ref<IAudioSessionControl>) -> windows::core::Result<()> {
        self.0.poke();
        Ok(())
    }
}

#[implement(IAudioSessionEvents)]
struct SessionEvents(Poke);

impl IAudioSessionEvents_Impl for SessionEvents_Impl {
    fn OnDisplayNameChanged(&self, _: &PCWSTR, _: *const windows::core::GUID) -> windows::core::Result<()> {
        Ok(())
    }
    fn OnIconPathChanged(&self, _: &PCWSTR, _: *const windows::core::GUID) -> windows::core::Result<()> {
        Ok(())
    }
    fn OnSimpleVolumeChanged(&self, _: f32, _: BOOL, _: *const windows::core::GUID) -> windows::core::Result<()> {
        self.0.poke();
        Ok(())
    }
    fn OnChannelVolumeChanged(
        &self,
        _: u32,
        _: *const f32,
        _: u32,
        _: *const windows::core::GUID,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn OnGroupingParamChanged(
        &self,
        _: *const windows::core::GUID,
        _: *const windows::core::GUID,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn OnStateChanged(&self, _: AudioSessionState) -> windows::core::Result<()> {
        self.0.poke();
        Ok(())
    }
    fn OnSessionDisconnected(&self, _: AudioSessionDisconnectReason) -> windows::core::Result<()> {
        self.0.poke();
        Ok(())
    }
}

/// The notification registrations for one default playback device. Dropping it unregisters everything.
struct Binding {
    device_id: String,
    volume: IAudioEndpointVolume,
    volume_events: IAudioEndpointVolumeCallback,
    manager: IAudioSessionManager2,
    new_session: IAudioSessionNotification,
    watched: HashMap<String, (IAudioSessionControl, IAudioSessionEvents)>,
    poke: Poke,
}

impl Binding {
    fn new(poke: &Poke) -> Result<Self, String> {
        let device = devices::default_device(eRender)?;
        let volume = devices::endpoint_volume(&device)?;
        let volume_events: IAudioEndpointVolumeCallback = VolumeEvents(poke.clone()).into();
        // SAFETY: the callback is unregistered in Drop before it is released.
        unsafe { volume.RegisterControlChangeNotify(&volume_events) }
            .map_err(|e| format!("volume notifications: {e}"))?;
        let manager = sessions::manager_for(&device)?;
        let new_session: IAudioSessionNotification = NewSession(poke.clone()).into();
        // SAFETY: as above; unregistered in Drop.
        unsafe { manager.RegisterSessionNotification(&new_session) }
            .map_err(|e| format!("session notifications: {e}"))?;
        Ok(Self {
            device_id: devices::device_id(&device),
            volume,
            volume_events,
            manager,
            new_session,
            watched: HashMap::new(),
            poke: poke.clone(),
        })
    }

    /// Listens to every current session and forgets those that ended.
    fn watch(&mut self, current: &[sessions::Session]) {
        self.watched.retain(|id, (control, events)| {
            let keep = current.iter().any(|s| &s.row.instance_id == id);
            if !keep {
                // SAFETY: unregistering the callback this binding registered.
                let _ = unsafe { control.UnregisterAudioSessionNotification(&*events) };
            }
            keep
        });
        for s in current {
            if self.watched.contains_key(&s.row.instance_id) {
                continue;
            }
            let events: IAudioSessionEvents = SessionEvents(self.poke.clone()).into();
            // SAFETY: unregistered when the session ends or in Drop.
            if unsafe { s.control.RegisterAudioSessionNotification(&events) }.is_ok() {
                self.watched.insert(s.row.instance_id.clone(), (s.control.clone(), events));
            }
        }
    }
}

impl Drop for Binding {
    fn drop(&mut self) {
        // SAFETY: each call undoes a registration made in `new` or `watch`.
        unsafe {
            let _ = self.volume.UnregisterControlChangeNotify(&self.volume_events);
            let _ = self.manager.UnregisterSessionNotification(&self.new_session);
            for (control, events) in self.watched.values() {
                let _ = control.UnregisterAudioSessionNotification(events);
            }
        }
    }
}

pub struct Audio {
    emitter: Emitter,
    state: Shared<Option<AudioState>>,
    worker: Mutex<Option<Worker<Refresh>>>,
}

impl Audio {
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
        let worker = Worker::spawn("tiles-audio", move |rx, tx| {
            let _com = ComGuard::new();
            let poke = Poke(tx);
            let client: IMMNotificationClient = DeviceEvents(poke.clone()).into();
            let enumerator = devices::enumerator();
            if let Ok(e) = &enumerator {
                // SAFETY: unregistered before the worker ends.
                let _ = unsafe { e.RegisterEndpointNotificationCallback(&client) };
            }
            let mut engine = Engine { binding: None, names: NameCache::default(), poke, state, emitter };
            engine.refresh();
            // The receiver lives in `start` until the first reading, then is dropped.
            let _ = ready_tx.send(());
            while let Ok(Some(_)) = rx.recv() {
                if !coalesce(&rx, COALESCE) {
                    break;
                }
                engine.refresh();
            }
            drop(engine);
            if let Ok(e) = &enumerator {
                unregister(e, &client);
            }
        })
        .map_err(|e| format!("could not start the audio worker: {e}"))?;
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

    /// The latest state while subscribed, else a one-off reading.
    pub fn state(&self) -> AudioState {
        lock(&self.state).clone().unwrap_or_else(read_once)
    }
}

fn unregister(e: &IMMDeviceEnumerator, client: &IMMNotificationClient) {
    // SAFETY: undoes the registration made when the worker started.
    let _ = unsafe { e.UnregisterEndpointNotificationCallback(client) };
}

struct Engine {
    binding: Option<Binding>,
    names: NameCache,
    poke: Poke,
    state: Shared<Option<AudioState>>,
    emitter: Emitter,
}

impl Engine {
    fn refresh(&mut self) {
        let default_id = devices::default_device(eRender).map(|d| devices::device_id(&d)).ok();
        let stale = match (&self.binding, &default_id) {
            (Some(b), Some(id)) => &b.device_id != id,
            (None, None) => false,
            _ => true,
        };
        if stale {
            self.binding = default_id.and_then(|_| Binding::new(&self.poke).ok());
        }
        let current = self.binding.as_ref().map(|b| sessions::read(&b.manager)).unwrap_or_default();
        if let Some(b) = self.binding.as_mut() {
            b.watch(&current);
        }
        let new_state = compose(self.binding.as_ref().map(|b| &b.volume), &current, &mut self.names);
        let changed = lock(&self.state).as_ref() != Some(&new_state);
        if changed {
            *lock(&self.state) = Some(new_state.clone());
            self.emitter.emit(TileData::Audio(new_state));
        }
    }
}

fn compose(volume: Option<&IAudioEndpointVolume>, current: &[sessions::Session], names: &mut NameCache) -> AudioState {
    let (level, muted) = volume.map(devices::read_volume).unwrap_or((0.0, false));
    let rows: Vec<sessions::Row> = current.iter().map(|s| s.row.clone()).collect();
    AudioState {
        available: volume.is_some(),
        volume: level,
        muted,
        devices: devices::list(eRender),
        apps: sessions::group(&rows, names),
    }
}

/// One reading without notifications, for a tile that is asked about once (or a command that needs the result).
pub fn read_once() -> AudioState {
    let mut names = NameCache::default();
    let device = devices::default_device(eRender).ok();
    let volume = device.as_ref().and_then(|d| devices::endpoint_volume(d).ok());
    let current =
        device.as_ref().and_then(|d| sessions::manager_for(d).ok()).map(|m| sessions::read(&m)).unwrap_or_default();
    compose(volume.as_ref(), &current, &mut names)
}

fn default_output_volume() -> Result<IAudioEndpointVolume, String> {
    devices::endpoint_volume(&devices::default_device(eRender)?)
}

pub fn set_volume(volume: f32) -> Result<(), String> {
    let target = volume.clamp(0.0, 1.0);
    // SAFETY: plain setter on a live interface; a null event context means "no particular origin".
    unsafe { default_output_volume()?.SetMasterVolumeLevelScalar(target, std::ptr::null()) }
        .map_err(|e| format!("could not set the volume: {e}"))
}

pub fn set_muted(muted: bool) -> Result<(), String> {
    // SAFETY: as in set_volume.
    unsafe { default_output_volume()?.SetMute(muted, std::ptr::null()) }
        .map_err(|e| format!("could not change mute: {e}"))
}

pub fn set_default_device(device_id: &str) -> Result<(), String> {
    devices::by_id(device_id)?;
    policy::set_default_playback(device_id)
}

pub fn set_app_volume(app_id: &str, volume: f32) -> Result<(), String> {
    let manager = sessions::manager_for(&devices::default_device(eRender)?)?;
    let target = volume.clamp(0.0, 1.0);
    // SAFETY: plain setter; null event context.
    sessions::for_app(&manager, app_id, |v| unsafe { v.SetMasterVolume(target, std::ptr::null()) })
}

pub fn set_app_muted(app_id: &str, muted: bool) -> Result<(), String> {
    let manager = sessions::manager_for(&devices::default_device(eRender)?)?;
    // SAFETY: plain setter; null event context.
    sessions::for_app(&manager, app_id, |v| unsafe { v.SetMute(muted, std::ptr::null()) })
}
