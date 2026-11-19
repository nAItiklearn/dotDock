//! Quick toggles: Wi-Fi, Bluetooth, brightness, night light, Do Not Disturb.
//!
//! One worker thread waits on kernel events (radio state changes, the brightness power notification, two registry
//! change notifications) and re-reads the five states when any of them fires. No timers.

pub mod brightness;
pub mod radios;
pub mod system;
mod wmi;

use crate::com::ComGuard;
use crate::emit::{lock, shared, Emitter, Shared};
use crate::protocol::{TileData, TogglesState};
use crate::registry::KeyWatch;
use crate::winloop::{wait_any, Event, EventThread};
use radios::Kind;
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const START_TIMEOUT: Duration = Duration::from_secs(5);

/// One-off reading of every toggle (used when nobody is subscribed yet).
pub fn read_once() -> TogglesState {
    TogglesState {
        wifi: radios::read_once(Kind::Wifi),
        bluetooth: radios::read_once(Kind::Bluetooth),
        brightness: brightness::read(),
        night_light: system::night_light(),
        do_not_disturb: system::do_not_disturb(),
    }
}

pub struct Toggles {
    emitter: Emitter,
    state: Shared<Option<TogglesState>>,
    thread: Mutex<Option<EventThread>>,
}

impl Toggles {
    pub fn new(emitter: Emitter) -> Self {
        Self { emitter, state: shared(None), thread: Mutex::new(None) }
    }

    pub fn start(&self) -> Result<(), String> {
        let mut slot = lock(&self.thread);
        if slot.is_some() {
            return Ok(());
        }
        let (ready_tx, ready_rx) = channel();
        let state = self.state.clone();
        let emitter = self.emitter.clone();
        let thread = EventThread::spawn("tiles-toggles", move |stop| {
            let _com = ComGuard::new();
            let Ok(wake) = Event::new().map(Arc::new) else { return };
            let radio_watch = radios::Watch::open(&wake);
            let _brightness_watch = brightness::Watch::open(&wake);
            let night = KeyWatch::open(system::NIGHT_LIGHT_KEY);
            let notifications = KeyWatch::open(system::NOTIFICATION_SETTINGS_KEY);
            let mut ready = Some(ready_tx);
            loop {
                let next = TogglesState {
                    wifi: radio_watch.toggle(Kind::Wifi),
                    bluetooth: radio_watch.toggle(Kind::Bluetooth),
                    brightness: brightness::read(),
                    night_light: system::night_light(),
                    do_not_disturb: system::do_not_disturb(),
                };
                if lock(&state).as_ref() != Some(&next) {
                    *lock(&state) = Some(next.clone());
                    emitter.emit(TileData::Toggles(next));
                }
                if let Some(tx) = ready.take() {
                    let _ = tx.send(());
                }
                let mut handles = vec![stop.handle(), wake.handle()];
                handles.extend(night.iter().map(|w| w.event.handle()));
                handles.extend(notifications.iter().map(|w| w.event.handle()));
                match wait_any(&handles) {
                    None | Some(0) => break,
                    Some(1) => {}
                    Some(i) => {
                        // Registry notifications fire once; ask for the next change before reading.
                        let watched = [night.as_ref(), notifications.as_ref()].into_iter().flatten().nth(i - 2);
                        if let Some(w) = watched {
                            w.arm();
                        }
                    }
                }
            }
        })?;
        *slot = Some(thread);
        drop(slot);
        let _ = ready_rx.recv_timeout(START_TIMEOUT);
        Ok(())
    }

    pub fn stop(&self) {
        let thread = lock(&self.thread).take();
        drop(thread);
        *lock(&self.state) = None;
    }

    pub fn state(&self) -> TogglesState {
        lock(&self.state).clone().unwrap_or_else(read_once)
    }
}
