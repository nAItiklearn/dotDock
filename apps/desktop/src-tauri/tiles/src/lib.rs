//! Native data providers for the dock's live tiles.
//!
//! `TileHub` is the entry point; `protocol` holds the wire types, mirrored by `apps/desktop/src/dock/tilesProtocol.ts`.
//! See `docs/dock/TILES.md` for what each tile reads, when it runs and what was measured.
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

pub use emit::Emitter;
pub use hub::TileHub;
pub use paths::DataDir;
