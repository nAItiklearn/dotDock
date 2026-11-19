//! How providers hand data to the host.

use crate::protocol::TileData;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

/// Pushes a tile's new data to the dock window. The host supplies the closure (Tauri `emit` in the app).
#[derive(Clone)]
pub struct Emitter(Arc<dyn Fn(TileData) + Send + Sync>);

impl Emitter {
    pub fn new(f: impl Fn(TileData) + Send + Sync + 'static) -> Self {
        Self(Arc::new(f))
    }

    pub fn emit(&self, data: TileData) {
        (self.0)(data);
    }
}

/// Locks a mutex and carries on if another thread panicked while holding it: tile state is plain data that
/// stays valid, and one failed provider must not take the dock down.
pub fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A value shared between a provider's worker thread and the command side.
pub type Shared<T> = Arc<Mutex<T>>;

pub fn shared<T>(value: T) -> Shared<T> {
    Arc::new(Mutex::new(value))
}
