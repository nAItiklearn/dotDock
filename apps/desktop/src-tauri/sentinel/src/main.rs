// No console window in any build: the watcher has no window and prints nothing.
#![windows_subsystem = "windows"]

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    std::process::exit(dotdock_shell::sentinel::run(&args));
}
