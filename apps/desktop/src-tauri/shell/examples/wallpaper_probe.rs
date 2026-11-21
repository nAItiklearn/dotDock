//! Prints the wallpaper Windows is showing on the primary monitor. Diagnostic for `wallpaper::current`.
use dotdock_shell::wallpaper;

fn main() {
    match wallpaper::current() {
        Ok(Some(path)) => match wallpaper::current_image() {
            Ok(bytes) => println!("{} ({} bytes)", path.display(), bytes.len()),
            Err(e) => println!("{} but it cannot be read: {e}", path.display()),
        },
        Ok(None) => println!("a solid colour"),
        Err(e) => println!("Windows would not say: {e}"),
    }
}
