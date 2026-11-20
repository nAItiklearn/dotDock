//! COM plumbing shared by the catalogue, the icon extractor and the window mapper.

use windows::core::{Interface, PCWSTR, PWSTR};
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PropVariantToStringAlloc, PROPVARIANT};
use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;

/// Initialises COM as a single-threaded apartment on this thread for as long as it lives. Shell links and
/// the shell item interfaces need an STA. If the thread already has COM in another mode, the guard does
/// nothing and the calls still work.
pub struct ComGuard {
    initialised: bool,
}

impl ComGuard {
    pub fn new() -> ComGuard {
        // SAFETY: balanced by `CoUninitialize` in `Drop` when this call succeeded.
        let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        ComGuard { initialised: hr.is_ok() }
    }
}

impl Default for ComGuard {
    fn default() -> Self {
        ComGuard::new()
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.initialised {
            // SAFETY: pairs with the successful `CoInitializeEx` in `new`.
            unsafe { CoUninitialize() };
        }
    }
}

/// UTF-16 with a terminating zero, for `PCWSTR` arguments.
pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn pcwstr(buf: &[u16]) -> PCWSTR {
    PCWSTR(buf.as_ptr())
}

/// A zero-terminated UTF-16 buffer up to its first zero.
pub fn from_wide(buf: &[u16]) -> String {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len])
}

/// Copies a COM-allocated string out and frees it.
pub fn take_pwstr(p: PWSTR) -> String {
    if p.is_null() {
        return String::new();
    }
    // SAFETY: `p` is a zero-terminated string allocated with `CoTaskMemAlloc` by the callee, freed exactly once here.
    unsafe {
        let s = p.to_string().unwrap_or_default();
        CoTaskMemFree(Some(p.0 as *const _));
        s
    }
}

/// Reads a string property from a property store; `None` when it is missing, empty or not a string.
pub fn store_string(store: &IPropertyStore, key: &PROPERTYKEY) -> Option<String> {
    // SAFETY: GetValue fills a PROPVARIANT we own and clear; the string conversion allocates with CoTaskMemAlloc.
    unsafe {
        let mut value: PROPVARIANT = store.GetValue(key).ok()?;
        let text = PropVariantToStringAlloc(&value).ok().map(take_pwstr);
        let _ = PropVariantClear(&mut value);
        text.filter(|t| !t.trim().is_empty())
    }
}

/// `windows::core::Interface::cast` that turns the failure into `None`.
pub fn cast<I: Interface, T: Interface>(i: &I) -> Option<T> {
    i.cast::<T>().ok()
}
