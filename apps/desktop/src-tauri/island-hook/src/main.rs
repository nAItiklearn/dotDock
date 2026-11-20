//! Hook runner for Agent Island.
//!
//! Registered for several hook events of Claude Code and GitHub Copilot CLI; reads the event JSON from stdin,
//! records it for the island and exits. It must never slow an agent down or report a failure, so it always exits
//! with code 0, even if something panics (the panic hook exits before the release profile's abort can turn it
//! into a crash).

fn main() {
    std::panic::set_hook(Box::new(|_| std::process::exit(0)));
    let args: Vec<String> = std::env::args().skip(1).collect();
    dotdock_island::hook::run(&args);
}
