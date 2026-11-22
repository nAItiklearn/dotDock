//! Reading and watching values under `HKEY_CURRENT_USER` (this crate never writes the registry).

use crate::com::wide;
use crate::winloop::Event;
use windows::core::PCWSTR;
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::System::Registry::{
    RegCloseKey, RegGetValueW, RegNotifyChangeKeyValue, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_NOTIFY,
    REG_NOTIFY_CHANGE_LAST_SET, REG_NOTIFY_FILTER, REG_NOTIFY_THREAD_AGNOSTIC, RRF_RT_REG_BINARY, RRF_RT_REG_DWORD,
};

pub fn read_dword(path: &str, name: &str) -> Option<u32> {
    let (path_w, name_w) = (wide(path), wide(name));
    let mut value = 0u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    // SAFETY: the output buffer is a u32 and `size` says so.
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            PCWSTR(path_w.as_ptr()),
            PCWSTR(name_w.as_ptr()),
            RRF_RT_REG_DWORD,
            None,
            Some((&mut value as *mut u32).cast()),
            Some(&mut size),
        )
    };
    (status == ERROR_SUCCESS).then_some(value)
}

pub fn read_binary(path: &str, name: &str) -> Option<Vec<u8>> {
    let (path_w, name_w) = (wide(path), wide(name));
    let mut size = 0u32;
    // SAFETY: first call asks for the size only; the second fills a buffer of exactly that size.
    unsafe {
        let probe = RegGetValueW(
            HKEY_CURRENT_USER,
            PCWSTR(path_w.as_ptr()),
            PCWSTR(name_w.as_ptr()),
            RRF_RT_REG_BINARY,
            None,
            None,
            Some(&mut size),
        );
        if probe != ERROR_SUCCESS {
            return None;
        }
        let mut data = vec![0u8; size as usize];
        let status = RegGetValueW(
            HKEY_CURRENT_USER,
            PCWSTR(path_w.as_ptr()),
            PCWSTR(name_w.as_ptr()),
            RRF_RT_REG_BINARY,
            None,
            Some(data.as_mut_ptr().cast()),
            Some(&mut size),
        );
        (status == ERROR_SUCCESS).then(|| {
            data.truncate(size as usize);
            data
        })
    }
}

/// Signals an event when a value directly under a key changes. Call `arm` again after each signal.
pub struct KeyWatch {
    key: HKEY,
    pub event: Event,
}

impl KeyWatch {
    pub fn open(path: &str) -> Option<Self> {
        let path_w = wide(path);
        let mut key = HKEY::default();
        // SAFETY: the key handle is closed in Drop.
        let status = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, PCWSTR(path_w.as_ptr()), None, KEY_NOTIFY, &mut key) };
        if status != ERROR_SUCCESS {
            return None;
        }
        let watch = Self { key, event: Event::new().ok()? };
        watch.arm();
        Some(watch)
    }

    pub fn arm(&self) {
        // THREAD_AGNOSTIC keeps the registration alive whichever thread calls this.
        let filter = REG_NOTIFY_FILTER(REG_NOTIFY_CHANGE_LAST_SET.0 | REG_NOTIFY_THREAD_AGNOSTIC.0);
        // SAFETY: the event handle outlives the registration (both are owned by `self`).
        let _ = unsafe { RegNotifyChangeKeyValue(self.key, false, filter, Some(self.event.handle()), true) };
    }
}

impl Drop for KeyWatch {
    fn drop(&mut self) {
        // SAFETY: closing the key this value opened; pending notifications are cancelled by the close.
        let _ = unsafe { RegCloseKey(self.key) };
    }
}
