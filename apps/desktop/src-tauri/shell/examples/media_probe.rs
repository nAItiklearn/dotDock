//! Prints what the system media session reports right now. Diagnostic for the media provider.
use dotdock_shell::providers::media::{MediaProvider, Reading};

fn main() {
    match MediaProvider::new().read() {
        Reading::Playing(d) => println!(
            "{} | {} | {} | {:.0}/{:.0}s playing={} artwork={} next={} prev={} seek={}",
            d.title,
            d.artist,
            d.album,
            d.position_seconds,
            d.duration_seconds,
            d.playing,
            d.artwork.as_ref().map(|a| format!("{} chars", a.len())).unwrap_or_else(|| "none".into()),
            d.can_next,
            d.can_prev,
            d.can_seek
        ),
        Reading::Nothing => println!("no active media session"),
        Reading::Unavailable => println!("media session manager unavailable"),
    }
}
