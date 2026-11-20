//! Clipboard history.
//!
//! A hidden message-only window registered with `AddClipboardFormatListener` sleeps until Windows says the
//! clipboard changed (`WM_CLIPBOARDUPDATE`). Then, before reading a single byte, the copy's privacy markers are
//! checked (see `policy`): a copy flagged by a password manager is never read. Text and images are kept in memory
//! only, unless the user turns on the encrypted cache (DPAPI, off by default). The thread exists only while the
//! clipboard tile is subscribed, and a stopped provider forgets its in-memory history.

mod policy;
mod store;
mod vault;

use crate::appname::NameCache;
use crate::clock::now_ms;
use crate::com::{process_image_path, wide};
use crate::emit::{lock, Emitter};
use crate::paths;
use crate::protocol::{ClipboardState, TileData};
use crate::settings::Settings;
use policy::Signals;
use std::path::PathBuf;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use store::{Content, Store};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HANDLE, HGLOBAL, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::DataExchange::{
    AddClipboardFormatListener, CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardOwner,
    IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW, RemoveClipboardFormatListener,
    SetClipboardData,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::System::Ole::{CF_DIB, CF_UNICODETEXT};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW, GetWindowLongPtrW,
    GetWindowThreadProcessId, KillTimer, PostMessageW, PostQuitMessage, RegisterClassW, SetTimer, SetWindowLongPtrW,
    TranslateMessage, CREATESTRUCTW, GWLP_USERDATA, HWND_MESSAGE, MSG, WINDOW_EX_STYLE, WINDOW_STYLE, WM_APP,
    WM_CLIPBOARDUPDATE, WM_CLOSE, WM_DESTROY, WM_NCCREATE, WM_TIMER, WNDCLASSW,
};

/// Another app can hold the clipboard open for a moment after it changes; try this many times, this far apart.
const OPEN_ATTEMPTS: u32 = 10;
const OPEN_RETRY: Duration = Duration::from_millis(15);
/// The history is written to the encrypted cache at most this often (the spec's write budget).
const PERSIST_DELAY_MS: u32 = 1000;
const PERSIST_TIMER_ID: usize = 1;
/// Posted to the window thread to ask for a delayed cache write.
const WM_PERSIST: u32 = WM_APP + 1;
const CLASS_NAME: &str = "dotdock-clipboard-listener";
const START_TIMEOUT: Duration = Duration::from_secs(3);

struct Formats {
    exclude_from_monitor: u32,
    viewer_ignore: u32,
    include_in_history: u32,
}

impl Formats {
    fn register() -> Self {
        let reg = |name: &str| {
            let w = wide(name);
            // SAFETY: NUL-terminated name; registering the same name twice returns the same id.
            unsafe { RegisterClipboardFormatW(PCWSTR(w.as_ptr())) }
        };
        Self {
            exclude_from_monitor: reg("ExcludeClipboardContentFromMonitorProcessing"),
            viewer_ignore: reg("Clipboard Viewer Ignore"),
            include_in_history: reg("CanIncludeInClipboardHistory"),
        }
    }
}

struct Inner {
    emitter: Emitter,
    settings: Settings,
    vault_path: PathBuf,
    formats: Formats,
    store: Mutex<Store>,
    names: Mutex<NameCache>,
    window: AtomicIsize,
}

fn available(format: u32) -> bool {
    // SAFETY: a plain query that needs no open clipboard.
    unsafe { IsClipboardFormatAvailable(format) }.is_ok()
}

/// Opens the clipboard, waiting briefly if another app has it.
fn open(hwnd: Option<HWND>) -> bool {
    for _ in 0..OPEN_ATTEMPTS {
        // SAFETY: balanced by CloseClipboard in the callers.
        if unsafe { OpenClipboard(hwnd) }.is_ok() {
            return true;
        }
        thread::sleep(OPEN_RETRY);
    }
    false
}

/// Runs `read` on a locked global memory block of the open clipboard's `format`.
fn with_global<T>(format: u32, read: impl FnOnce(*const u8, usize) -> T) -> Option<T> {
    // SAFETY: the clipboard is open (caller), the block belongs to the clipboard and is only read while locked.
    unsafe {
        let handle = GetClipboardData(format).ok()?;
        let global = HGLOBAL(handle.0);
        let size = GlobalSize(global);
        let ptr = GlobalLock(global);
        if ptr.is_null() {
            return None;
        }
        let out = read(ptr as *const u8, size);
        let _ = GlobalUnlock(global);
        Some(out)
    }
}

fn read_text() -> Option<String> {
    with_global(u32::from(CF_UNICODETEXT.0), |ptr, size| {
        // SAFETY: `ptr` is valid for `size` bytes while the block is locked.
        let units = unsafe { std::slice::from_raw_parts(ptr as *const u16, size / 2) };
        let end = units.iter().position(|&u| u == 0).unwrap_or(units.len());
        String::from_utf16_lossy(&units[..end])
    })
}

fn read_image() -> Option<Content> {
    let dib = with_global(u32::from(CF_DIB.0), |ptr, size| {
        // SAFETY: as in read_text.
        unsafe { std::slice::from_raw_parts(ptr, size) }.to_vec()
    })?;
    let info = crate::image::parse_dib(&dib)?;
    Some(Content::Image { width: info.width, height: info.height, dib })
}

fn read_include_in_history(format: u32) -> Option<u32> {
    with_global(format, |ptr, size| {
        // SAFETY: as in read_text.
        (size >= std::mem::size_of::<u32>()).then(|| unsafe { std::ptr::read_unaligned(ptr as *const u32) })
    })
    .flatten()
}

impl Inner {
    fn persisted(&self) -> bool {
        self.settings.get().clipboard_persisted
    }

    fn state(&self) -> ClipboardState {
        lock(&self.store).state(self.persisted())
    }

    fn publish(&self) {
        self.emitter.emit(TileData::Clipboard(self.state()));
        self.request_persist();
    }

    fn request_persist(&self) {
        let hwnd = self.window.load(Ordering::Relaxed);
        if self.persisted() && hwnd != 0 {
            // SAFETY: posting a private message to our own window; a stale handle just fails.
            let _ = unsafe { PostMessageW(Some(HWND(hwnd as *mut _)), WM_PERSIST, WPARAM(0), LPARAM(0)) };
        }
    }

    fn write_cache(&self) {
        let saved = lock(&self.store).to_saved();
        let result = serde_json::to_vec(&saved)
            .map_err(|e| e.to_string())
            .and_then(|json| vault::protect(&json))
            .and_then(|sealed| paths::write_atomic(&self.vault_path, &sealed));
        if let Err(e) = result {
            // Losing the cache is not worth interrupting anything; the in-memory history is intact.
            eprintln!("dotdock-tiles: clipboard cache not saved: {e}");
        }
    }

    fn load_cache(&self) -> Store {
        std::fs::read(&self.vault_path)
            .ok()
            .and_then(|sealed| vault::unprotect(&sealed).ok())
            .and_then(|json| serde_json::from_slice(&json).ok())
            .map(Store::from_saved)
            .unwrap_or_default()
    }

    /// The clipboard changed: record it unless its owner asked not to be recorded.
    fn on_update(&self, hwnd: HWND) {
        let mut signals = Signals {
            exclude_from_monitor: available(self.formats.exclude_from_monitor),
            viewer_ignore: available(self.formats.viewer_ignore),
            include_in_history: None,
        };
        if !policy::allows_recording(signals) {
            return;
        }
        // SAFETY: plain queries about the window that put the data on the clipboard.
        let source = unsafe {
            GetClipboardOwner().ok().and_then(|owner| {
                let mut pid = 0u32;
                GetWindowThreadProcessId(owner, Some(&mut pid));
                process_image_path(pid)
            })
        };
        if !open(Some(hwnd)) {
            return;
        }
        if available(self.formats.include_in_history) {
            signals.include_in_history = read_include_in_history(self.formats.include_in_history);
        }
        let content = if policy::allows_recording(signals) {
            if available(u32::from(CF_UNICODETEXT.0)) {
                read_text().map(Content::Text)
            } else if available(u32::from(CF_DIB.0)) {
                read_image()
            } else {
                None
            }
        } else {
            None
        };
        // SAFETY: closes the clipboard opened above.
        let _ = unsafe { CloseClipboard() };
        let Some(content) = content else { return };
        let source = source.map(|path| lock(&self.names).name_for(&path));
        if lock(&self.store).add(content, now_ms(), source) {
            self.publish();
        }
    }
}

unsafe extern "system" fn window_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    // SAFETY: GWLP_USERDATA holds the pointer to the `Inner` kept alive by the window thread for the window's life.
    unsafe {
        if msg == WM_NCCREATE {
            let create = &*(lparam.0 as *const CREATESTRUCTW);
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, create.lpCreateParams as isize);
            return DefWindowProcW(hwnd, msg, wparam, lparam);
        }
        let inner = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *const Inner;
        match msg {
            WM_CLIPBOARDUPDATE if !inner.is_null() => {
                (*inner).on_update(hwnd);
                LRESULT(0)
            }
            WM_PERSIST => {
                SetTimer(Some(hwnd), PERSIST_TIMER_ID, PERSIST_DELAY_MS, None);
                LRESULT(0)
            }
            WM_TIMER if !inner.is_null() => {
                let _ = KillTimer(Some(hwnd), PERSIST_TIMER_ID);
                if (*inner).persisted() {
                    (*inner).write_cache();
                }
                LRESULT(0)
            }
            WM_CLOSE => {
                let _ = DestroyWindow(hwnd);
                LRESULT(0)
            }
            WM_DESTROY => {
                let _ = RemoveClipboardFormatListener(hwnd);
                PostQuitMessage(0);
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }
}

struct Listener {
    hwnd: isize,
    join: Option<JoinHandle<()>>,
}

impl Listener {
    fn spawn(inner: Arc<Inner>) -> Result<Self, String> {
        let (tx, rx) = channel::<Result<isize, String>>();
        let join = thread::Builder::new()
            .name("tiles-clipboard".to_owned())
            .spawn(move || {
                // SAFETY: a standard hidden message window; every handle is released before the thread ends.
                unsafe {
                    let instance = GetModuleHandleW(None).unwrap_or_default();
                    let class = wide(CLASS_NAME);
                    let wc = WNDCLASSW {
                        lpfnWndProc: Some(window_proc),
                        hInstance: instance.into(),
                        lpszClassName: PCWSTR(class.as_ptr()),
                        ..Default::default()
                    };
                    // Registering twice (a restart of the provider) fails harmlessly: the class already exists.
                    RegisterClassW(&wc);
                    let created = CreateWindowExW(
                        WINDOW_EX_STYLE(0),
                        PCWSTR(class.as_ptr()),
                        PCWSTR::null(),
                        WINDOW_STYLE(0),
                        0,
                        0,
                        0,
                        0,
                        Some(HWND_MESSAGE),
                        None,
                        Some(instance.into()),
                        Some(Arc::as_ptr(&inner).cast()),
                    );
                    let hwnd = match created {
                        Ok(h) => h,
                        Err(e) => {
                            let _ = tx.send(Err(format!("could not create the clipboard window: {e}")));
                            return;
                        }
                    };
                    if let Err(e) = AddClipboardFormatListener(hwnd) {
                        let _ = tx.send(Err(format!("Windows would not report clipboard changes: {e}")));
                        let _ = DestroyWindow(hwnd);
                        return;
                    }
                    inner.window.store(hwnd.0 as isize, Ordering::Relaxed);
                    let _ = tx.send(Ok(hwnd.0 as isize));
                    let mut msg = MSG::default();
                    while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                        let _ = TranslateMessage(&msg);
                        DispatchMessageW(&msg);
                    }
                    inner.window.store(0, Ordering::Relaxed);
                }
            })
            .map_err(|e| format!("could not start the clipboard thread: {e}"))?;
        let hwnd = rx.recv_timeout(START_TIMEOUT).map_err(|_| "the clipboard thread did not start".to_owned())??;
        Ok(Self { hwnd, join: Some(join) })
    }

    fn stop(&mut self) {
        // SAFETY: asks our own window to close; if it is already gone the post simply fails.
        let _ = unsafe { PostMessageW(Some(HWND(self.hwnd as *mut _)), WM_CLOSE, WPARAM(0), LPARAM(0)) };
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

pub struct Clipboard {
    inner: Arc<Inner>,
    listener: Mutex<Option<Listener>>,
}

impl Clipboard {
    pub fn new(emitter: Emitter, settings: Settings, vault_path: PathBuf) -> Self {
        let inner = Arc::new(Inner {
            emitter,
            settings,
            vault_path,
            formats: Formats::register(),
            store: Mutex::new(Store::new()),
            names: Mutex::new(NameCache::default()),
            window: AtomicIsize::new(0),
        });
        Self { inner, listener: Mutex::new(None) }
    }

    pub fn start(&self) -> Result<(), String> {
        let mut slot = lock(&self.listener);
        if slot.is_some() {
            return Ok(());
        }
        if self.inner.persisted() {
            *lock(&self.inner.store) = self.inner.load_cache();
        }
        *slot = Some(Listener::spawn(self.inner.clone())?);
        Ok(())
    }

    pub fn stop(&self) {
        let listener = lock(&self.listener).take();
        if let Some(mut l) = listener {
            l.stop();
            if self.inner.persisted() {
                self.inner.write_cache();
            }
        }
        *lock(&self.inner.store) = Store::new();
    }

    pub fn state(&self) -> ClipboardState {
        self.inner.state()
    }

    /// Puts an entry back on the clipboard and moves it to the top.
    pub fn paste(&self, id: u64) -> Result<(), String> {
        let content =
            lock(&self.inner.store).get(id).map(|e| e.content.clone()).ok_or("that clipboard entry is gone")?;
        set_content(&content)?;
        lock(&self.inner.store).touch(id, now_ms());
        self.inner.publish();
        Ok(())
    }

    pub fn pin(&self, id: u64, pinned: bool) {
        if lock(&self.inner.store).pin(id, pinned) {
            self.inner.publish();
        }
    }

    pub fn remove(&self, id: u64) {
        if lock(&self.inner.store).remove(id) {
            self.inner.publish();
        }
    }

    pub fn clear(&self) {
        if lock(&self.inner.store).clear() {
            self.inner.publish();
        }
    }

    /// Turns the encrypted cache on or off. Turning it off deletes the file.
    pub fn set_persisted(&self, persisted: bool) -> Result<(), String> {
        self.inner.settings.update(|v| v.clipboard_persisted = persisted)?;
        if persisted {
            self.inner.write_cache();
        } else if let Err(e) = std::fs::remove_file(&self.inner.vault_path) {
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(format!("could not delete the clipboard cache: {e}"));
            }
        }
        self.inner.emitter.emit(TileData::Clipboard(self.inner.state()));
        Ok(())
    }
}

/// A global memory block holding `bytes`, ready to hand to `SetClipboardData`.
fn alloc_global(bytes: &[u8]) -> Result<HGLOBAL, String> {
    // SAFETY: the block is sized for `bytes`, filled while locked, and ownership passes to the clipboard on success.
    unsafe {
        let global = GlobalAlloc(GMEM_MOVEABLE, bytes.len()).map_err(|e| format!("out of memory: {e}"))?;
        let ptr = GlobalLock(global);
        if ptr.is_null() {
            return Err("could not lock clipboard memory".to_owned());
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr as *mut u8, bytes.len());
        let _ = GlobalUnlock(global);
        Ok(global)
    }
}

fn set_content(content: &Content) -> Result<(), String> {
    let (format, bytes) = match content {
        Content::Text(t) => {
            let units: Vec<u8> = t.encode_utf16().chain(std::iter::once(0)).flat_map(u16::to_le_bytes).collect();
            (u32::from(CF_UNICODETEXT.0), units)
        }
        Content::Image { dib, .. } => (u32::from(CF_DIB.0), dib.clone()),
    };
    if !open(None) {
        return Err("another app is using the clipboard".to_owned());
    }
    let result = alloc_global(&bytes).and_then(|global| {
        // SAFETY: the clipboard is open and owned by this thread.
        unsafe {
            let _ = EmptyClipboard();
            SetClipboardData(format, Some(HANDLE(global.0)))
                .map(|_| ())
                .map_err(|e| format!("could not set the clipboard: {e}"))
        }
    });
    // SAFETY: closes the clipboard opened above.
    let _ = unsafe { CloseClipboard() };
    result
}

/// Puts plain text on the clipboard (the colour picker's "copy hex").
pub fn set_text(text: &str) -> Result<(), String> {
    set_content(&Content::Text(text.to_owned()))
}
