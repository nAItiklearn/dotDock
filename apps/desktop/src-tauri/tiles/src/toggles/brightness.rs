//! Brightness of the built-in laptop panel, through the active power plan.
//!
//! The level is the plan's "display brightness" setting for the current power source, read and written with the
//! documented power-setting API (the same value the Windows brightness slider changes), and applied at once by
//! re-activating the plan. Changes made elsewhere (the Fn keys, the Windows slider, auto brightness) arrive as the
//! documented power setting notification `GUID_VIDEO_CURRENT_MONITOR_BRIGHTNESS`. Desktops and machines without
//! an internal panel report "not available".

use crate::com::wide;
use crate::protocol::Brightness;
use crate::winloop::Event;
use std::ffi::c_void;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Arc;
use windows::core::{GUID, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, LocalFree, ERROR_SUCCESS, GENERIC_READ, HANDLE, HLOCAL, WIN32_ERROR};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows::Win32::System::Power::{
    GetSystemPowerStatus, PowerGetActiveScheme, PowerReadACValueIndex, PowerReadDCValueIndex,
    PowerSettingRegisterNotification, PowerSettingUnregisterNotification, PowerWriteACValueIndex,
    PowerWriteDCValueIndex, DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS, HPOWERNOTIFY, POWERBROADCAST_SETTING,
    SYSTEM_POWER_STATUS,
};
use windows::Win32::UI::WindowsAndMessaging::DEVICE_NOTIFY_CALLBACK;

/// `ACLineStatus` value for "on AC power".
const AC_ONLINE: u8 = 1;
/// `GUID_VIDEO_SUBGROUP`: {7516b95f-f776-4464-8c53-06167f40cc99}.
const VIDEO_SUBGROUP: GUID = GUID::from_u128(0x7516b95f_f776_4464_8c53_06167f40cc99);
/// `GUID_DEVICE_POWER_POLICY_VIDEO_BRIGHTNESS`, the plan's normal display brightness: {aded5e82-b909-4619-9949-f5d71dac0bcb}.
const NORMAL_BRIGHTNESS: GUID = GUID::from_u128(0xaded5e82_b909_4619_9949_f5d71dac0bcb);
/// `GUID_VIDEO_CURRENT_MONITOR_BRIGHTNESS`, the level the panel really has now: {8ffee2c6-2d01-46be-adb9-398addc5b4ff}.
const CURRENT_BRIGHTNESS: GUID = GUID::from_u128(0x8ffee2c6_2d01_46be_adb9_398addc5b4ff);
/// The power setting is a percentage.
const PERCENT_MAX: f32 = 100.0;
/// Means "no notification has reported a level yet".
const UNREPORTED: i32 = -1;

/// The level the panel last reported through the notification, in percent.
static REPORTED: AtomicI32 = AtomicI32::new(UNREPORTED);

/// True when this machine has a built-in panel (the `\\.\LCD` device exists).
fn has_internal_panel() -> bool {
    let path = wide(r"\\.\LCD");
    // SAFETY: path is NUL-terminated; the handle is closed straight away.
    match unsafe {
        CreateFileW(
            PCWSTR(path.as_ptr()),
            GENERIC_READ.0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            None,
        )
    } {
        Ok(handle) => {
            // SAFETY: closing the handle just opened.
            let _ = unsafe { CloseHandle(handle) };
            true
        }
        Err(_) => false,
    }
}

fn on_ac_power() -> bool {
    let mut status = SYSTEM_POWER_STATUS::default();
    // SAFETY: writes only into the struct we own.
    unsafe { GetSystemPowerStatus(&mut status) }.is_ok() && status.ACLineStatus == AC_ONLINE
}

/// The active power plan's id.
fn active_scheme() -> Option<GUID> {
    let mut scheme: *mut GUID = std::ptr::null_mut();
    // SAFETY: on success `scheme` points to memory the call allocated; we copy the GUID and free it.
    unsafe {
        if PowerGetActiveScheme(None, &mut scheme) != ERROR_SUCCESS || scheme.is_null() {
            return None;
        }
        let id = *scheme;
        let _ = LocalFree(Some(HLOCAL(scheme.cast())));
        Some(id)
    }
}

fn plan_percent(scheme: &GUID) -> Option<u32> {
    let mut value = 0u32;
    // SAFETY: the output is a u32 owned here; all GUID pointers are valid for the call.
    let status = unsafe {
        if on_ac_power() {
            PowerReadACValueIndex(None, Some(scheme), Some(&VIDEO_SUBGROUP), Some(&NORMAL_BRIGHTNESS), &mut value)
        } else {
            WIN32_ERROR(PowerReadDCValueIndex(
                None,
                Some(scheme),
                Some(&VIDEO_SUBGROUP),
                Some(&NORMAL_BRIGHTNESS),
                &mut value,
            ))
        }
    };
    (status == ERROR_SUCCESS).then_some(value)
}

pub fn read() -> Brightness {
    let off = Brightness { available: false, level: 0.0 };
    if !has_internal_panel() {
        return off;
    }
    let reported = REPORTED.load(Ordering::Relaxed);
    let percent = if reported >= 0 { Some(reported as u32) } else { active_scheme().and_then(|s| plan_percent(&s)) };
    match percent {
        Some(p) => Brightness { available: true, level: (p as f32 / PERCENT_MAX).clamp(0.0, 1.0) },
        None => off,
    }
}

/// Sets the panel brightness for the power source in use, 0 to 1.
pub fn set(fraction: f32) -> Result<(), String> {
    if !has_internal_panel() {
        return Err("This PC has no built-in display brightness control".to_owned());
    }
    let percent = (fraction.clamp(0.0, 1.0) * PERCENT_MAX).round() as u32;
    // Immediate change of the panel. Re-activating the power plan would also apply it, but takes about two seconds.
    super::wmi::set_brightness(percent as u8)?;
    // Remember it in the active plan so Windows keeps this level when it re-applies the plan (a power-source change).
    // The plan write is best effort: the panel already has the level, so a failure here changes nothing visible.
    if let Some(scheme) = active_scheme() {
        // SAFETY: GUID pointers are valid for each call.
        let _ = unsafe {
            if on_ac_power() {
                PowerWriteACValueIndex(None, &scheme, Some(&VIDEO_SUBGROUP), Some(&NORMAL_BRIGHTNESS), percent)
            } else {
                WIN32_ERROR(PowerWriteDCValueIndex(
                    None,
                    &scheme,
                    Some(&VIDEO_SUBGROUP),
                    Some(&NORMAL_BRIGHTNESS),
                    percent,
                ))
            }
        };
    }
    REPORTED.store(percent as i32, Ordering::Relaxed);
    Ok(())
}

/// Signals `wake` whenever Windows reports a new current brightness.
pub struct Watch {
    handle: HPOWERNOTIFY,
    // Kept alive because the callback holds a raw pointer to it.
    _context: Box<Arc<Event>>,
    _params: Box<DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS>,
}

unsafe extern "system" fn on_brightness(context: *const c_void, _kind: u32, setting: *const c_void) -> u32 {
    // SAFETY: `setting` points to a POWERBROADCAST_SETTING whose DWORD payload is the brightness percentage, and
    // `context` is the boxed Arc stored in `Watch`, which unregisters before dropping it.
    unsafe {
        let setting = &*(setting as *const POWERBROADCAST_SETTING);
        if setting.PowerSetting == CURRENT_BRIGHTNESS && setting.DataLength as usize >= std::mem::size_of::<u32>() {
            let percent = std::ptr::read_unaligned(setting.Data.as_ptr().cast::<u32>());
            REPORTED.store(percent.min(100) as i32, Ordering::Relaxed);
        }
        (&*(context as *const Arc<Event>)).signal();
    }
    0
}

impl Watch {
    /// None on machines without a built-in panel, where there is nothing to watch.
    pub fn open(wake: &Arc<Event>) -> Option<Self> {
        if !has_internal_panel() {
            return None;
        }
        let context = Box::new(wake.clone());
        let params = Box::new(DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
            Callback: Some(on_brightness),
            Context: &*context as *const Arc<Event> as *mut c_void,
        });
        let mut handle = std::ptr::null_mut();
        // SAFETY: the callback and context outlive the registration, which Drop removes first.
        let status = unsafe {
            PowerSettingRegisterNotification(
                &CURRENT_BRIGHTNESS,
                DEVICE_NOTIFY_CALLBACK,
                HANDLE(&*params as *const DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS as *mut c_void),
                &mut handle,
            )
        };
        if status != ERROR_SUCCESS {
            return None;
        }
        Some(Self { handle: HPOWERNOTIFY(handle as isize), _context: context, _params: params })
    }
}

impl Drop for Watch {
    fn drop(&mut self) {
        // SAFETY: undoes the registration made in `open`.
        let _ = unsafe { PowerSettingUnregisterNotification(self.handle) };
        REPORTED.store(UNREPORTED, Ordering::Relaxed);
    }
}
