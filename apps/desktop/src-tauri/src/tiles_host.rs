//! Hosts the dock's live tiles: the `dotdock-tiles` crate's [`DockTiles`] behind the wire names the dock UI calls
//! (`apps/desktop/src/dock/tiles/backend.ts`, `TILES_WIRE`). Feeds and the microphone level go to the dock window
//! only. Every call blocks (providers start threads and talk to Windows), so every command here runs off the main
//! thread (`async`).

use crate::dock_host::DOCK_LABEL;
use dotdock_shell::boot_log;
use dotdock_tiles::protocol::ContactAction;
use dotdock_tiles::wire::{AudioOp, FeedName, HydrationOp, StopwatchOp};
use dotdock_tiles::{DataDir, DockEvent, DockTiles, EVENT_FEEDS, EVENT_MIC_LEVEL};
use tauri::{AppHandle, Emitter, Manager, State};

/// Folder of the tiles' own files (stopwatch, water log, contacts) inside the app data folder.
const DATA_FOLDER: &str = "tiles";

pub struct TilesState(DockTiles);

/// Starts the tile providers' door. Nothing runs until the dock window watches a feed. Without an app data folder
/// there are no tiles (logged), and every tile command reports that the core is missing.
pub fn start(app: &AppHandle) {
    let Some(data) = dotdock_shell::app_data_dir() else {
        boot_log::record("tiles: no app data folder, not started");
        return;
    };
    let sink = app.clone();
    let tiles = DockTiles::new(DataDir::at(data.join(DATA_FOLDER)), move |event| forward(&sink, event));
    app.manage(TilesState(tiles));
}

/// Stops every provider at exit, so no capture stream or worker outlives the app.
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<TilesState>() {
        state.0.shutdown();
    }
}

fn forward(app: &AppHandle, event: DockEvent) {
    let _ = match event {
        DockEvent::Feeds(update) => app.emit_to(DOCK_LABEL, EVENT_FEEDS, *update),
        DockEvent::MicLevel(level) => app.emit_to(DOCK_LABEL, EVENT_MIC_LEVEL, level),
    };
}

#[tauri::command(async)]
pub fn dock_tiles_watch(feeds: Vec<FeedName>, state: State<'_, TilesState>) {
    state.0.watch(&feeds);
}

#[tauri::command(async)]
pub fn dock_tiles_unwatch(state: State<'_, TilesState>) {
    state.0.unwatch();
}

#[tauri::command(async)]
pub fn dock_mic_watch(state: State<'_, TilesState>) -> Result<(), String> {
    state.0.mic_watch()
}

#[tauri::command(async)]
pub fn dock_mic_unwatch(state: State<'_, TilesState>) {
    state.0.mic_unwatch();
}

#[tauri::command(async)]
pub fn dock_contact(id: String, action: ContactAction, state: State<'_, TilesState>) -> Result<(), String> {
    state.0.contact(&id, action)
}

#[tauri::command(async)]
pub fn dock_join_meeting(url: String, state: State<'_, TilesState>) -> Result<(), String> {
    state.0.join_meeting(&url)
}

#[tauri::command(async)]
pub fn dock_stopwatch(op: StopwatchOp, state: State<'_, TilesState>) -> Result<(), String> {
    state.0.stopwatch(op)
}

#[tauri::command(async)]
pub fn dock_toggle_mic(state: State<'_, TilesState>) -> Result<(), String> {
    state.0.toggle_mic()
}

#[tauri::command(async)]
pub fn dock_hydration(op: HydrationOp, state: State<'_, TilesState>) -> Result<(), String> {
    state.0.hydration(op)
}

#[tauri::command(async)]
pub fn dock_audio(op: AudioOp, state: State<'_, TilesState>) -> Result<(), String> {
    state.0.audio(op)
}
