//! Native data providers for the dock's live tiles.
//!
//! `DockTiles` is the door for the tiles the dock UI shows first: seven feeds and six commands in the shapes of
//! `wire`, which follow the UI's `tiles/ui-types.ts`. `TileHub` is the generic door for the other tiles (clipboard,
//! screenshots, downloads, shelf, toggles, system history, voice memo, colour picker); its `protocol` types are
//! mirrored by `apps/desktop/src/dock/tilesProtocol.ts`. See `docs/dock/TILES.md` for what each tile reads, when it
//! runs and what was measured.
#![cfg(windows)]

pub mod appname;
#[cfg(test)]
mod audible;
pub mod audio;
pub mod calendar;
pub mod clipboard;
pub mod clock;
pub mod colour;
pub mod com;
pub mod contacts;
pub mod dock;
pub mod emit;
pub mod folder;
pub mod history;
mod hub;
pub mod hydration;
pub mod image;
pub mod microphone;
pub mod paths;
pub mod protocol;
pub mod registry;
pub mod screenshots;
pub mod settings;
pub mod shelf;
pub mod shell;
pub mod stopwatch;
pub mod thumbs;
pub mod toggles;
pub mod voicememo;
pub mod wav;
pub mod winloop;
pub mod wire;
pub mod zone;

pub use dock::{DockEvent, DockTiles, EVENT_FEEDS, EVENT_MIC_LEVEL};
pub use emit::Emitter;
pub use hub::TileHub;
pub use paths::DataDir;
