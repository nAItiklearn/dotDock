//! Agent Island core: follows what Claude Code, Codex and any other AI coding agent are doing and turns it into a small, ordered view.
//!
//! - `hook` + `state`: the hook binary records one JSON state file per session.
//! - `transcript` + `codex`: read the agents' own local logs for interruptions, limits, errors and token counts.
//! - `engine`: merges every source into the snapshot the island shows.
//! - `connect` + `hookexe`: reversible Claude Code hook registration.
//! - `monitor` (feature `watch`): the event loop that ties watching, parsing and the engine together.
//! - `focus`, `pointer`, `sound`: bring the terminal forward, follow the cursor, play the chimes.
//!
//! Reads local files only. No network, no AI calls, no Tauri dependency.

pub mod agents;
pub mod codex;
pub mod connect;
pub mod copilot;
pub mod describe;
pub mod engine;
pub mod feed;
pub mod focus;
pub mod hook;
pub mod hookexe;
#[cfg(feature = "watch")]
pub mod monitor;
pub mod opencode;
pub mod paths;
pub mod phase;
pub mod pointer;
pub mod problem;
pub mod process;
#[cfg(feature = "watch")]
pub mod service;
pub mod settings;
pub mod sound;
pub mod state;
pub mod tail;
pub mod transcript;
pub mod util;

pub use paths::ClaudeDirs;
pub use phase::{AgentKind, Phase};
pub use problem::{Problem, ProblemKind};
pub use state::SessionState;
