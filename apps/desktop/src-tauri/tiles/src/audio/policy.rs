//! Switching the default playback device.
//!
//! Windows has no documented API for this. Every tool that does it (SoundSwitch, NirSoft SoundVolumeView, the
//! PowerShell AudioDeviceCmdlets module) calls the undocumented `IPolicyConfig` COM interface of
//! `PolicyConfigClient`, which is what the Sound control panel itself uses. It has kept the same layout from
//! Windows 7 to Windows 11. Decision D-024 records the choice. This is the only place that interface is used,
//! and a failure is reported to the user as "Windows would not switch", never hidden.

use crate::com::wide;
use windows::core::{interface, IUnknown, IUnknown_Vtbl, BOOL, GUID, HRESULT, PCWSTR};
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::Media::Audio::{eCommunications, eConsole, eMultimedia, ERole, WAVEFORMATEX};
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

/// `CLSID_PolicyConfigClient`.
const POLICY_CONFIG_CLIENT: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

/// The Windows 7 and later layout of `IPolicyConfig`. Only `SetDefaultEndpoint` is called; the other slots
/// exist to put it at the right position in the vtable.
#[interface("f8679f50-850a-41cf-9c72-430f290290c8")]
unsafe trait IPolicyConfig: IUnknown {
    fn get_mix_format(&self, device: PCWSTR, format: *mut *mut WAVEFORMATEX) -> HRESULT;
    fn get_device_format(&self, device: PCWSTR, default: BOOL, format: *mut *mut WAVEFORMATEX) -> HRESULT;
    fn reset_device_format(&self, device: PCWSTR) -> HRESULT;
    fn set_device_format(&self, device: PCWSTR, endpoint: *mut WAVEFORMATEX, mix: *mut WAVEFORMATEX) -> HRESULT;
    fn get_processing_period(
        &self,
        device: PCWSTR,
        default: BOOL,
        default_period: *mut i64,
        min_period: *mut i64,
    ) -> HRESULT;
    fn set_processing_period(&self, device: PCWSTR, period: *mut i64) -> HRESULT;
    fn get_share_mode(&self, device: PCWSTR, mode: *mut core::ffi::c_void) -> HRESULT;
    fn set_share_mode(&self, device: PCWSTR, mode: *mut core::ffi::c_void) -> HRESULT;
    fn get_property_value(&self, device: PCWSTR, fx: BOOL, key: *const PROPERTYKEY, value: *mut PROPVARIANT)
        -> HRESULT;
    fn set_property_value(&self, device: PCWSTR, fx: BOOL, key: *const PROPERTYKEY, value: *mut PROPVARIANT)
        -> HRESULT;
    fn set_default_endpoint(&self, device_id: PCWSTR, role: ERole) -> HRESULT;
    fn set_endpoint_visibility(&self, device: PCWSTR, visible: BOOL) -> HRESULT;
}

/// Makes `device_id` the default playback device for apps and for system sounds. The communications role follows
/// only when it was following the old default, so a separate headset for calls is left alone.
pub fn set_default_playback(device_id: &str) -> Result<(), String> {
    crate::com::ensure();
    let communications_followed_console = {
        let console = super::devices::default_device(windows::Win32::Media::Audio::eRender)
            .map(|d| super::devices::device_id(&d));
        let comms = super::devices::enumerator().and_then(|e| {
            // SAFETY: the enumerator is alive for the call.
            unsafe { e.GetDefaultAudioEndpoint(windows::Win32::Media::Audio::eRender, eCommunications) }
                .map_err(|e| e.to_string())
                .map(|d| super::devices::device_id(&d))
        });
        matches!((console, comms), (Ok(a), Ok(b)) if a == b)
    };
    // SAFETY: CLSID and IID are the published values every tool uses; the interface is released on drop.
    let policy: IPolicyConfig = unsafe { CoCreateInstance(&POLICY_CONFIG_CLIENT, None, CLSCTX_ALL) }
        .map_err(|e| format!("Windows would not open its audio policy service: {e}"))?;
    let id = wide(device_id);
    let mut roles = vec![eConsole, eMultimedia];
    if communications_followed_console {
        roles.push(eCommunications);
    }
    for role in roles {
        // SAFETY: `id` is NUL-terminated and outlives the call.
        unsafe { policy.set_default_endpoint(PCWSTR(id.as_ptr()), role) }
            .ok()
            .map_err(|e| format!("Windows would not switch the output device: {e}"))?;
    }
    Ok(())
}
