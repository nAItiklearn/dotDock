//! Core Audio endpoints shared by playback (`audio`) and the microphone.

use crate::protocol::{AudioDevice, DeviceKind};
use windows::core::Interface;
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    eCapture, eConsole, eRender, EDataFlow, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::StructuredStorage::{PropVariantToStringAlloc, PropVariantToUInt32};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL, STGM_READ};

/// `PKEY_AudioEndpoint_FormFactor`: {1da5d803-d492-4edd-8c23-e0c0ffee7f0e}, 0.
const FORM_FACTOR_KEY: PROPERTYKEY =
    PROPERTYKEY { fmtid: windows::core::GUID::from_u128(0x1da5d803_d492_4edd_8c23_e0c0ffee7f0e), pid: 0 };
/// Values of `EndpointFormFactor` that matter for choosing an icon.
const FORM_SPEAKERS: u32 = 1;
const FORM_HEADPHONES: u32 = 3;
const FORM_MICROPHONE: u32 = 4;
const FORM_HEADSET: u32 = 5;
const FORM_SPDIF: u32 = 8;
const FORM_HDMI: u32 = 9;
/// The shipped name of an unplugged or unnamed endpoint when Windows reports no friendly name.
const UNNAMED: &str = "Audio device";

pub fn enumerator() -> Result<IMMDeviceEnumerator, String> {
    crate::com::ensure();
    // SAFETY: standard COM activation of the system device enumerator.
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.map_err(|e| format!("audio enumerator: {e}"))
}

pub fn default_device(flow: EDataFlow) -> Result<IMMDevice, String> {
    let e = enumerator()?;
    // SAFETY: the enumerator is alive for the call.
    unsafe { e.GetDefaultAudioEndpoint(flow, eConsole) }.map_err(|e| format!("no default audio device: {e}"))
}

pub fn endpoint_volume(device: &IMMDevice) -> Result<IAudioEndpointVolume, String> {
    // SAFETY: Activate writes a new interface pointer which `windows` wraps and releases for us.
    unsafe { device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) }.map_err(|e| format!("endpoint volume: {e}"))
}

pub fn device_id(device: &IMMDevice) -> String {
    // SAFETY: GetId returns a CoTaskMem string which take_co_string frees.
    unsafe { device.GetId() }.map(crate::com::take_co_string).unwrap_or_default()
}

fn friendly_name(device: &IMMDevice) -> String {
    // SAFETY: the property store and the variant live for this call only; the string is freed by take_co_string.
    let name = unsafe {
        device
            .OpenPropertyStore(STGM_READ)
            .and_then(|store| store.GetValue(&PKEY_Device_FriendlyName))
            .and_then(|v| PropVariantToStringAlloc(&v))
            .map(crate::com::take_co_string)
            .unwrap_or_default()
    };
    if name.is_empty() {
        UNNAMED.to_owned()
    } else {
        name
    }
}

fn kind_from_form_factor(code: u32, flow: EDataFlow) -> DeviceKind {
    match code {
        FORM_SPEAKERS => DeviceKind::Speakers,
        FORM_HEADPHONES => DeviceKind::Headphones,
        FORM_HEADSET => DeviceKind::Headset,
        FORM_MICROPHONE => DeviceKind::Microphone,
        FORM_HDMI => DeviceKind::Hdmi,
        FORM_SPDIF => DeviceKind::Digital,
        _ if flow == eCapture => DeviceKind::Microphone,
        _ => DeviceKind::Other,
    }
}

fn device_kind(device: &IMMDevice, flow: EDataFlow) -> DeviceKind {
    // SAFETY: as in friendly_name.
    let code = unsafe {
        device
            .OpenPropertyStore(STGM_READ)
            .and_then(|store| store.GetValue(&FORM_FACTOR_KEY))
            .and_then(|v| PropVariantToUInt32(&v))
    };
    kind_from_form_factor(code.unwrap_or(u32::MAX), flow)
}

pub struct Described {
    pub id: String,
    pub name: String,
    pub kind: DeviceKind,
}

pub fn describe(device: &IMMDevice, flow: EDataFlow) -> Described {
    Described { id: device_id(device), name: friendly_name(device), kind: device_kind(device, flow) }
}

/// Every active endpoint of one direction, the default first.
pub fn list(flow: EDataFlow) -> Vec<AudioDevice> {
    let Ok(e) = enumerator() else { return Vec::new() };
    let default_id = default_device(flow).map(|d| device_id(&d)).unwrap_or_default();
    // SAFETY: collection and devices are released when dropped.
    let Ok(collection) = (unsafe { e.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE) }) else { return Vec::new() };
    let count = unsafe { collection.GetCount() }.unwrap_or(0);
    let mut out: Vec<AudioDevice> = (0..count)
        .filter_map(|i| unsafe { collection.Item(i) }.ok())
        .map(|d| {
            let info = describe(&d, flow);
            AudioDevice { is_default: info.id == default_id, id: info.id, name: info.name, kind: info.kind }
        })
        .collect();
    out.sort_by_key(|d| !d.is_default);
    out
}

pub fn render_flow() -> EDataFlow {
    eRender
}

pub fn capture_flow() -> EDataFlow {
    eCapture
}

/// Looks an endpoint up by the id `list` returned.
pub fn by_id(id: &str) -> Result<IMMDevice, String> {
    let e = enumerator()?;
    let wide = crate::com::wide(id);
    // SAFETY: `wide` is NUL-terminated and outlives the call.
    unsafe { e.GetDevice(windows::core::PCWSTR(wide.as_ptr())) }.map_err(|e| format!("audio device not found: {e}"))
}

/// The master volume of an endpoint, 0 to 1, and its mute flag.
pub fn read_volume(vol: &IAudioEndpointVolume) -> (f32, bool) {
    // SAFETY: plain getters on a live interface.
    let level = unsafe { vol.GetMasterVolumeLevelScalar() }.unwrap_or(0.0);
    let muted = unsafe { vol.GetMute() }.map(|b| b.as_bool()).unwrap_or(false);
    (level.clamp(0.0, 1.0), muted)
}

pub fn same_interface<T: Interface>(a: &T, b: &T) -> bool {
    a.as_raw() == b.as_raw()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn form_factors_map_to_kinds() {
        assert_eq!(kind_from_form_factor(FORM_HEADPHONES, eRender), DeviceKind::Headphones);
        assert_eq!(kind_from_form_factor(FORM_HDMI, eRender), DeviceKind::Hdmi);
        assert_eq!(kind_from_form_factor(99, eCapture), DeviceKind::Microphone);
        assert_eq!(kind_from_form_factor(99, eRender), DeviceKind::Other);
    }
}
