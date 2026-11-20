//! Native data providers for the dock's live tiles.
#![cfg(windows)]

pub mod appname;
pub mod audio;
#[cfg(test)]
mod audible;
pub mod calendar;
pub mod clipboard;
pub mod clock;
pub mod colour;
pub mod com;
pub mod contacts;
pub mod emit;
pub mod folder;
pub mod history;
pub mod image;
pub mod microphone;
pub mod paths;
pub mod protocol;
pub mod registry;
pub mod screenshots;
pub mod settings;
pub mod shelf;
pub mod shell;
pub mod thumbs;
pub mod toggles;
pub mod voicememo;
pub mod wav;
pub mod winloop;
