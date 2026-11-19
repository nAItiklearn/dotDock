//! Claude Code hook runner for Agent Island.
//!
//! Registered for several hook events; reads the event JSON from stdin, records it in the session's state
//! file and exits. It must never slow Claude Code down or report a failure, so it always exits with code 0,
//! even if something panics (the panic hook exits before the release profile's abort can turn it into a crash).

fn main() {
    std::panic::set_hook(Box::new(|_| std::process::exit(0)));
    dotdock_island::hook::run_from_stdin();
}
