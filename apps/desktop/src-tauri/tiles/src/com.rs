//! COM and Win32 plumbing shared by the providers.

use std::sync::mpsc::{Receiver, Sender};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_MULTITHREADED};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};

/// Keeps COM initialised for the thread that owns it (multithreaded apartment).
///
/// If the thread already runs a single-threaded apartment (the UI thread), COM is usable as it is and nothing
/// is undone on drop.
pub struct ComGuard(bool);

impl ComGuard {
    pub fn new() -> Self {
        // SAFETY: plain initialisation call; the matching CoUninitialize runs in Drop only when this call succeeded.
        let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        Self(hr.is_ok())
    }
}

impl Default for ComGuard {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.0 {
            // SAFETY: balances the successful CoInitializeEx in `new`.
            unsafe { CoUninitialize() };
        }
    }
}

thread_local! {
    static THREAD_COM: ComGuard = ComGuard::new();
}

/// Makes sure the calling thread can use COM (commands run on whatever thread the host calls from).
pub fn ensure() {
    THREAD_COM.with(|_| {});
}

/// Wide string with a trailing NUL for passing to Win32.
pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Reads a NUL-terminated wide string.
pub fn pcwstr_to_string(p: PCWSTR) -> String {
    if p.is_null() {
        return String::new();
    }
    // SAFETY: callers pass strings Windows hands to callbacks, which are NUL-terminated.
    unsafe { p.to_string() }.unwrap_or_default()
}

/// Reads and frees a `CoTaskMemAlloc`ed wide string.
pub fn take_co_string(p: PWSTR) -> String {
    if p.is_null() {
        return String::new();
    }
    // SAFETY: p came from a COM call that documents CoTaskMemFree for it.
    let s = unsafe { p.to_string() }.unwrap_or_default();
    unsafe { CoTaskMemFree(Some(p.0 as *const _)) };
    s
}

/// Full path of the executable of a process, when we are allowed to ask.
pub fn process_image_path(pid: u32) -> Option<String> {
    if pid == 0 {
        return None;
    }
    // SAFETY: the handle is closed below; the buffer length is passed by pointer and updated by the call.
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = vec![0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = windows::Win32::Foundation::CloseHandle(handle);
        ok.then(|| String::from_utf16_lossy(&buf[..len as usize]))
    }
}

/// Closes a handle, ignoring the result: there is nothing to do if closing fails.
pub fn close(handle: HANDLE) {
    // SAFETY: the caller owns the handle and does not use it afterwards.
    let _ = unsafe { windows::Win32::Foundation::CloseHandle(handle) };
}

/// A background thread that consumes messages until told to stop. Dropping it stops and joins the thread.
pub struct Worker<M: Send + 'static> {
    tx: Sender<Option<M>>,
    join: Option<JoinHandle<()>>,
}

impl<M: Send + 'static> Worker<M> {
    /// Starts `body` on a named thread. `body` gets the receiver; `None` on it means "stop".
    pub fn spawn(
        name: &str,
        body: impl FnOnce(Receiver<Option<M>>, Sender<Option<M>>) + Send + 'static,
    ) -> std::io::Result<Self> {
        let (tx, rx) = std::sync::mpsc::channel();
        let self_tx = tx.clone();
        let join = thread::Builder::new().name(name.to_owned()).spawn(move || body(rx, self_tx))?;
        Ok(Self { tx, join: Some(join) })
    }

    pub fn sender(&self) -> Sender<Option<M>> {
        self.tx.clone()
    }

    pub fn stop(&mut self) {
        let _ = self.tx.send(None);
        if let Some(join) = self.join.take() {
            // A panic in the worker was already reported by its thread; nothing more to do here.
            let _ = join.join();
        }
    }
}

impl<M: Send + 'static> Drop for Worker<M> {
    fn drop(&mut self) {
        self.stop();
    }
}

/// The message of workers that only need to be told "look again".
pub struct Refresh;

/// Like `coalesce`, but stops waiting after `cap`, so a steady stream of events (a download that keeps growing)
/// still produces a refresh now and then.
pub fn coalesce_capped<M>(rx: &Receiver<Option<M>>, quiet: Duration, cap: Duration) -> bool {
    let deadline = std::time::Instant::now() + cap;
    loop {
        let left = deadline.saturating_duration_since(std::time::Instant::now());
        if left.is_zero() {
            return true;
        }
        match rx.recv_timeout(quiet.min(left)) {
            Ok(Some(_)) => {}
            Ok(None) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return false,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => return true,
        }
    }
}

/// After a message arrived, keeps absorbing messages that follow within `window` so a burst becomes one refresh.
/// Returns false when the worker should stop.
pub fn coalesce<M>(rx: &Receiver<Option<M>>, window: Duration) -> bool {
    loop {
        match rx.recv_timeout(window) {
            Ok(Some(_)) => {}
            Ok(None) => return false,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => return true,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return false,
        }
    }
}
