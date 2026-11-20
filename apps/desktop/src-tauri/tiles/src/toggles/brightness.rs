//! Brightness of the built-in laptop panel, through the active power plan.
//!
//! The level is the plan's "display brightness" setting for the current power source, read and written with the
//! documented power-setting API (the same value the Windows brightness slider changes), and applied at once through
//! the panel's WMI brightness method (re-activating the plan would take about two seconds). Changes made elsewhere (the Fn keys, the Windows slider, auto brightness) arrive as the
//! documented power setting notification `GUID_VIDEO_CURRENT_MONITOR_BRIGHTNESS`. Desktops and machines without
//! an internal panel report "not available".

use super::wmi;
use crate::com::wide;
use crate::protocol::Brightness;
use crate::winloop::Event;
use std::ffi::c_void;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;
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

/// One request to the brightness thread.
struct Request {
    percent: u8,
    done: Sender<Result<(), String>>,
}

/// A connection to the panel's brightness control.
trait Backlight {
    fn set(&self, percent: u8) -> Result<(), String>;
}

impl Backlight for wmi::Panel {
    fn set(&self, percent: u8) -> Result<(), String> {
        wmi::Panel::set(self, percent)
    }
}

/// The brightness thread's inbox while it runs. It holds the WMI connection (slow to open, fast to reuse), serves
/// only the newest of several queued requests so a slider drag never falls behind, and exits after a quiet spell.
static WORKER: Mutex<Option<Sender<Request>>> = Mutex::new(None);
const IDLE_EXIT: Duration = Duration::from_secs(20);

/// Serves requests from `inbox` until none arrives for `idle`; on leaving it empties `slot`, which is where
/// callers find the inbox. `open` connects to the panel.
fn serve<P: Backlight>(
    inbox: Receiver<Request>,
    slot: &Mutex<Option<Sender<Request>>>,
    idle: Duration,
    open: impl Fn() -> Result<P, String>,
) {
    let _com = crate::com::ComGuard::new();
    let mut panel: Option<P> = None;
    loop {
        let Ok(mut latest) = inbox.recv_timeout(idle) else {
            // Quiet for a while: leave, unless a request slipped in while we decided to.
            let mut slot = crate::emit::lock(slot);
            if inbox.try_recv().is_err() {
                *slot = None;
                return;
            }
            continue;
        };
        // Older requests in the queue are superseded: their callers are told they are done.
        while let Ok(newer) = inbox.try_recv() {
            let _ = std::mem::replace(&mut latest, newer).done.send(Ok(()));
        }
        let result = match panel.as_ref().map(|p| p.set(latest.percent)) {
            Some(Ok(())) => Ok(()),
            // No connection yet, or it went stale (display change, sleep): connect again once.
            _ => open().and_then(|p| {
                let r = p.set(latest.percent);
                panel = Some(p);
                r
            }),
        };
        let _ = latest.done.send(result);
    }
}

/// Hands a level to the brightness thread, starting it if it is not running, and waits for the panel to take it.
fn apply(percent: u8) -> Result<(), String> {
    let (done, finished) = std::sync::mpsc::channel();
    let mut request = Request { percent, done };
    loop {
        let mut slot = crate::emit::lock(&WORKER);
        let inbox = match slot.as_ref() {
            Some(inbox) => inbox,
            None => {
                let (tx, rx) = std::sync::mpsc::channel();
                std::thread::Builder::new()
                    .name("tiles-brightness".to_owned())
                    .spawn(move || serve(rx, &WORKER, IDLE_EXIT, wmi::Panel::open))
                    .map_err(|e| format!("could not start the brightness service: {e}"))?;
                slot.insert(tx)
            }
        };
        match inbox.send(request) {
            Ok(()) => break,
            Err(std::sync::mpsc::SendError(unsent)) => {
                // The thread just left; start a new one.
                request = unsent;
                *slot = None;
            }
        }
    }
    finished.recv().map_err(|_| "The brightness service stopped".to_owned())?
}

/// Sets the panel brightness for the power source in use, 0 to 1.
pub fn set(fraction: f32) -> Result<(), String> {
    if !has_internal_panel() {
        return Err("This PC has no built-in display brightness control".to_owned());
    }
    let percent = (fraction.clamp(0.0, 1.0) * PERCENT_MAX).round() as u32;
    // Immediate change of the panel. Re-activating the power plan would also apply it, but takes about two seconds.
    apply(percent as u8)?;
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
    // One strong count of the wake event, handed to the callback as a raw pointer and taken back in Drop.
    context: *const Event,
    _params: Box<DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS>,
}

unsafe extern "system" fn on_brightness(context: *const c_void, _kind: u32, setting: *const c_void) -> u32 {
    // SAFETY: `setting` points to a POWERBROADCAST_SETTING whose DWORD payload is the brightness percentage, and
    // `context` is the `Event` a strong count of `Watch` keeps alive until after it has unregistered.
    unsafe {
        let setting = &*(setting as *const POWERBROADCAST_SETTING);
        if setting.PowerSetting == CURRENT_BRIGHTNESS && setting.DataLength as usize >= std::mem::size_of::<u32>() {
            let percent = std::ptr::read_unaligned(setting.Data.as_ptr().cast::<u32>());
            REPORTED.store(percent.min(100) as i32, Ordering::Relaxed);
        }
        (*(context as *const Event)).signal();
    }
    0
}

impl Watch {
    /// None on machines without a built-in panel, where there is nothing to watch.
    pub fn open(wake: &Arc<Event>) -> Option<Self> {
        if !has_internal_panel() {
            return None;
        }
        let context = Arc::into_raw(wake.clone());
        let params = Box::new(DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
            Callback: Some(on_brightness),
            Context: context as *mut c_void,
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
            // SAFETY: takes back the count handed out above; nothing else holds the pointer.
            drop(unsafe { Arc::from_raw(context) });
            return None;
        }
        Some(Self { handle: HPOWERNOTIFY(handle as isize), context, _params: params })
    }
}

impl Drop for Watch {
    fn drop(&mut self) {
        // SAFETY: undoes the registration made in `open`, after which the callback can no longer run, and only
        // then takes back the strong count it was using.
        unsafe {
            let _ = PowerSettingUnregisterNotification(self.handle);
            drop(Arc::from_raw(self.context));
        }
        REPORTED.store(UNREPORTED, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::sync::mpsc::channel;

    /// A panel that records the levels it is given and can be made to fail like a connection gone stale.
    struct Recorder {
        levels: Arc<Mutex<Vec<u8>>>,
        stale: Arc<std::sync::atomic::AtomicBool>,
    }

    impl Backlight for Recorder {
        fn set(&self, percent: u8) -> Result<(), String> {
            if self.stale.load(Ordering::SeqCst) {
                return Err("the connection is stale".to_owned());
            }
            crate::emit::lock(&self.levels).push(percent);
            Ok(())
        }
    }

    struct Rig {
        levels: Arc<Mutex<Vec<u8>>>,
        stale: Arc<std::sync::atomic::AtomicBool>,
        opened: Arc<AtomicUsize>,
    }

    impl Rig {
        fn new() -> Self {
            Self { levels: Arc::default(), stale: Arc::default(), opened: Arc::default() }
        }

        /// The `open` function of a panel: every connection starts fresh and works.
        fn open(&self) -> impl Fn() -> Result<Recorder, String> {
            let (levels, stale, opened) = (self.levels.clone(), self.stale.clone(), self.opened.clone());
            move || {
                opened.fetch_add(1, Ordering::SeqCst);
                stale.store(false, Ordering::SeqCst);
                Ok(Recorder { levels: levels.clone(), stale: stale.clone() })
            }
        }
    }

    fn request(percent: u8) -> (Request, Receiver<Result<(), String>>) {
        let (done, finished) = channel();
        (Request { percent, done }, finished)
    }

    #[test]
    fn a_burst_of_requests_sets_only_the_newest_level() {
        let rig = Rig::new();
        let (tx, rx) = channel();
        let answers: Vec<_> = [10, 20, 30]
            .into_iter()
            .map(|p| {
                let (r, finished) = request(p);
                tx.send(r).unwrap();
                finished
            })
            .collect();
        let slot = Mutex::new(Some(tx));
        serve(rx, &slot, Duration::from_millis(50), rig.open());
        assert_eq!(*crate::emit::lock(&rig.levels), [30], "the panel was set once, to the last level");
        assert!(answers.iter().all(|a| a.recv().unwrap().is_ok()), "every caller is answered");
        assert!(crate::emit::lock(&slot).is_none(), "the thread left the slot empty when it quit");
    }

    #[test]
    fn a_stale_connection_is_replaced_and_the_level_still_lands() {
        let rig = Rig::new();
        let (tx, rx) = channel();
        let slot = Mutex::new(None);
        let open = rig.open();
        // The thread waits far longer than the test; dropping the last sender is what ends it.
        let server = std::thread::spawn(move || serve(rx, &slot, Duration::from_secs(30), open));
        let (first, first_done) = request(40);
        tx.send(first).unwrap();
        first_done.recv().unwrap().unwrap();
        rig.stale.store(true, Ordering::SeqCst);
        let (second, second_done) = request(55);
        tx.send(second).unwrap();
        second_done.recv().unwrap().expect("a new connection was made");
        drop(tx);
        server.join().unwrap();
        assert_eq!(*crate::emit::lock(&rig.levels), [40, 55]);
        assert_eq!(rig.opened.load(Ordering::SeqCst), 2, "one connection, then one replacement");
    }

    #[test]
    fn a_panel_that_cannot_be_reached_is_reported_to_the_caller() {
        let (tx, rx) = channel();
        let (r, finished) = request(70);
        tx.send(r).unwrap();
        let slot = Mutex::new(Some(tx));
        serve::<Recorder>(rx, &slot, Duration::from_millis(50), || Err("WMI is not available".to_owned()));
        assert_eq!(finished.recv().unwrap(), Err("WMI is not available".to_owned()));
    }
}
