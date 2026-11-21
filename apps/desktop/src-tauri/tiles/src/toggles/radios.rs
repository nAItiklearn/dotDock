//! Wi-Fi and Bluetooth through the Windows radio API (`Windows.Devices.Radios`), with change events.

use crate::protocol::Toggle;
use crate::winloop::Event;
use std::sync::Arc;
use windows::core::IInspectable;
use windows::Devices::Radios::{Radio, RadioAccessStatus, RadioKind, RadioState};
use windows::Foundation::TypedEventHandler;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Wifi,
    Bluetooth,
}

impl Kind {
    fn matches(self, kind: RadioKind) -> bool {
        match self {
            Kind::Wifi => kind == RadioKind::WiFi,
            Kind::Bluetooth => kind == RadioKind::Bluetooth,
        }
    }

    fn noun(self) -> &'static str {
        match self {
            Kind::Wifi => "Wi-Fi",
            Kind::Bluetooth => "Bluetooth",
        }
    }
}

fn request_access() -> Result<(), String> {
    let status = Radio::RequestAccessAsync()
        .and_then(|op| op.join())
        .map_err(|e| format!("Windows would not list the radios: {e}"))?;
    match status {
        RadioAccessStatus::Allowed => Ok(()),
        RadioAccessStatus::DeniedByUser => Err("Radio access is turned off in Windows privacy settings".to_owned()),
        _ => Err("Windows denied access to the radios".to_owned()),
    }
}

fn all_radios() -> Result<Vec<Radio>, String> {
    let list = Radio::GetRadiosAsync()
        .and_then(|op| op.join())
        .map_err(|e| format!("Windows would not list the radios: {e}"))?;
    Ok(list.into_iter().collect())
}

fn toggle_of(radio: Option<&Radio>, kind: Kind) -> Toggle {
    match radio.map(|r| r.State()) {
        None => Toggle { available: false, on: None, problem: Some(format!("No {} adapter found", kind.noun())) },
        Some(Ok(RadioState::On)) => Toggle { available: true, on: Some(true), problem: None },
        Some(Ok(RadioState::Off)) => Toggle { available: true, on: Some(false), problem: None },
        Some(Ok(_)) => Toggle {
            available: true,
            on: Some(false),
            problem: Some(format!("{} is disabled in Windows or by a hardware switch", kind.noun())),
        },
        Some(Err(e)) => {
            Toggle { available: false, on: None, problem: Some(format!("Could not read {}: {e}", kind.noun())) }
        }
    }
}

/// The radios found when the watch opened, each reporting changes to `wake`.
pub struct Watch {
    radios: Vec<(Radio, i64)>,
    problem: Option<String>,
}

impl Watch {
    pub fn open(wake: &Arc<Event>) -> Self {
        let (radios, problem) = match request_access().and_then(|()| all_radios()) {
            Ok(list) => (list, None),
            Err(e) => (Vec::new(), Some(e)),
        };
        let radios = radios
            .into_iter()
            .filter_map(|radio| {
                let wake = wake.clone();
                let handler = TypedEventHandler::<Radio, IInspectable>::new(move |_, _| {
                    wake.signal();
                    Ok(())
                });
                let token = radio.StateChanged(&handler).ok()?;
                Some((radio, token))
            })
            .collect();
        Self { radios, problem }
    }

    fn find(&self, kind: Kind) -> Option<&Radio> {
        self.radios.iter().map(|(r, _)| r).find(|r| r.Kind().map(|k| kind.matches(k)).unwrap_or(false))
    }

    pub fn toggle(&self, kind: Kind) -> Toggle {
        let mut t = toggle_of(self.find(kind), kind);
        if let (Some(problem), false) = (&self.problem, t.available) {
            t.problem = Some(problem.clone());
        }
        t
    }
}

impl Drop for Watch {
    fn drop(&mut self) {
        for (radio, token) in &self.radios {
            // The radio may already be gone (adapter unplugged); nothing to undo then.
            let _ = radio.RemoveStateChanged(*token);
        }
    }
}

/// One reading, without events.
pub fn read_once(kind: Kind) -> Toggle {
    match request_access().and_then(|()| all_radios()) {
        Ok(list) => {
            let radio = list.iter().find(|r| r.Kind().map(|k| kind.matches(k)).unwrap_or(false));
            toggle_of(radio, kind)
        }
        Err(e) => Toggle { available: false, on: None, problem: Some(e) },
    }
}

pub fn set(kind: Kind, on: bool) -> Result<(), String> {
    crate::com::ensure();
    request_access()?;
    let radio = all_radios()?
        .into_iter()
        .find(|r| r.Kind().map(|k| kind.matches(k)).unwrap_or(false))
        .ok_or_else(|| format!("No {} adapter found", kind.noun()))?;
    let target = if on { RadioState::On } else { RadioState::Off };
    let status = radio
        .SetStateAsync(target)
        .and_then(|op| op.join())
        .map_err(|e| format!("Windows would not switch {}: {e}", kind.noun()))?;
    match status {
        RadioAccessStatus::Allowed => Ok(()),
        _ => Err(format!("Windows denied switching {}", kind.noun())),
    }
}
