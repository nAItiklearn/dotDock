//! Dock backend: everything the dock needs from Windows, with no UI framework.
//!
//! - `catalogue`: the launchable apps (Start menu shortcuts and Store apps), merged and de-duplicated.
//! - `classify`: files each app into a category (user choice, bundled table, keyword rules, fallback).
//! - `icons`: 256 px PNG icons, cached on disk, extracted off the caller's thread.
//! - `running`: the windows that belong on a taskbar, pushed when they change; `frozen` says when to stop drawing.
//! - `launch`, `thumbnail`, `appbar`: start an app, DWM thumbnails, and the app-bar spike.
//! - `store`, `watch`: what is remembered between runs (atomic, at most one write a second) and when the catalogue
//!   is stale (change notifications, never a timer).
//! - `service`: one object the host holds, speaking the types in `protocol` (a mirror of `protocol.ts`).
//!
//! Nothing here hides the taskbar. The app bar module registers a bar only when explicitly asked, and its guard
//! removes it again; it is exercised from examples, never from the default code path. No network, no telemetry.

#[cfg(windows)]
pub mod appbar;
pub mod catalogue;
pub mod classify;
#[cfg(windows)]
pub mod com;
pub mod frozen;
#[cfg(windows)]
pub mod icons;
#[cfg(windows)]
pub mod launch;
pub mod protocol;
#[cfg(windows)]
pub mod running;
#[cfg(windows)]
pub mod service;
pub mod store;
#[cfg(windows)]
pub mod thumbnail;
pub mod util;
#[cfg(windows)]
pub mod watch;
