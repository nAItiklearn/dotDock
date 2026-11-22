//! Tauri's build step, plus the island hook embedded in the app (D-047).
//!
//! The installer and the portable exe ship `dotdock.exe` alone, so Connect had no hook program to install and failed
//! for every user. CI builds `dotdock-island-hook` first and names it in `DOTDOCK_EMBED_HOOK`; its bytes are then built
//! into the app, which writes them out when no hook sits beside the exe. A local build without the variable embeds
//! nothing and keeps using a hook beside the exe, as `cargo run` does.
use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-env-changed=DOTDOCK_EMBED_HOOK");
    let out = PathBuf::from(std::env::var_os("OUT_DIR").expect("cargo sets OUT_DIR")).join("island-hook.bin");
    let bytes = match std::env::var_os("DOTDOCK_EMBED_HOOK") {
        Some(path) => {
            let path = PathBuf::from(path);
            println!("cargo:rerun-if-changed={}", path.display());
            std::fs::read(&path).unwrap_or_else(|e| panic!("DOTDOCK_EMBED_HOOK {}: {e}", path.display()))
        }
        None => Vec::new(),
    };
    std::fs::write(&out, bytes).expect("write the embedded hook");
    tauri_build::build();
}
