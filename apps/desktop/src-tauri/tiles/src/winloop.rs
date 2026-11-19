//! Waiting on Windows kernel events: the base of the providers that must sleep until the system wakes them.

use std::sync::Arc;
use std::thread::{self, JoinHandle};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForMultipleObjects, INFINITE};

/// An auto-reset kernel event that any thread can signal.
pub struct Event(HANDLE);

// SAFETY: a kernel event handle may be used from any thread; the handle is closed exactly once, in Drop.
unsafe impl Send for Event {}
unsafe impl Sync for Event {}

impl Event {
    pub fn new() -> Result<Self, String> {
        // SAFETY: creating an unnamed auto-reset, initially unsignalled event.
        unsafe { CreateEventW(None, false, false, None) }
            .map(Self)
            .map_err(|e| format!("could not create an event: {e}"))
    }

    pub fn signal(&self) {
        // SAFETY: the handle is valid for the lifetime of `self`. A failure only means the event is gone.
        let _ = unsafe { SetEvent(self.0) };
    }

    pub fn handle(&self) -> HANDLE {
        self.0
    }
}

impl Drop for Event {
    fn drop(&mut self) {
        // SAFETY: closing the handle this value owns.
        let _ = unsafe { CloseHandle(self.0) };
    }
}

/// Blocks until one of `handles` is signalled and returns its index, or None if the wait failed.
pub fn wait_any(handles: &[HANDLE]) -> Option<usize> {
    // SAFETY: the handles are alive for the call; INFINITE sleeps until a handle is signalled.
    let r = unsafe { WaitForMultipleObjects(handles, false, INFINITE) };
    let idx = r.0.checked_sub(WAIT_OBJECT_0.0)? as usize;
    (idx < handles.len()).then_some(idx)
}

/// A thread that runs until its stop event is signalled. Dropping it stops and joins the thread.
pub struct EventThread {
    stop: Arc<Event>,
    join: Option<JoinHandle<()>>,
}

impl EventThread {
    /// Runs `body` on a named thread. `body` must return soon after `stop` is signalled.
    pub fn spawn(name: &str, body: impl FnOnce(Arc<Event>) + Send + 'static) -> Result<Self, String> {
        let stop = Arc::new(Event::new()?);
        let for_thread = stop.clone();
        let join = thread::Builder::new()
            .name(name.to_owned())
            .spawn(move || body(for_thread))
            .map_err(|e| format!("could not start {name}: {e}"))?;
        Ok(Self { stop, join: Some(join) })
    }

    pub fn stop(&mut self) {
        self.stop.signal();
        if let Some(join) = self.join.take() {
            // A panic was already reported by the thread itself.
            let _ = join.join();
        }
    }
}

impl Drop for EventThread {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[test]
    fn a_thread_wakes_on_a_signal_and_stops_on_drop() {
        let wake = Arc::new(Event::new().unwrap());
        let woke = Arc::new(AtomicBool::new(false));
        let (w, f) = (wake.clone(), woke.clone());
        let t = EventThread::spawn("test-loop", move |stop| loop {
            match wait_any(&[stop.handle(), w.handle()]) {
                Some(1) => f.store(true, Ordering::SeqCst),
                _ => break,
            }
        })
        .unwrap();
        wake.signal();
        for _ in 0..200 {
            if woke.load(Ordering::SeqCst) {
                break;
            }
            thread::sleep(std::time::Duration::from_millis(5));
        }
        assert!(woke.load(Ordering::SeqCst));
        drop(t);
    }
}
