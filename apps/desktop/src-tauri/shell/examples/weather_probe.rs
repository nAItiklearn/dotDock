//! One live Open-Meteo search + forecast for a city given on the command line. Saves nothing.
use dotdock_shell::providers::weather;

fn main() {
    let query = std::env::args().nth(1).unwrap_or_else(|| "Reykjavik".to_owned());
    match weather::search(&query, "en") {
        Ok(places) => match places.first() {
            Some(place) => {
                println!("place: {} ({})", place.name, place.detail);
                match weather::fetch(place, 0) {
                    Ok(w) => println!(
                        "now {:.1} C, high {:.1}, low {:.1}, code {}, day {}",
                        w.temperature_c, w.high_c, w.low_c, w.code, w.is_day
                    ),
                    Err(e) => println!("forecast error: {e}"),
                }
            }
            None => println!("no places found"),
        },
        Err(e) => println!("search error: {e}"),
    }
}
