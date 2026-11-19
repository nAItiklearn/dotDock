//! Weather from Open-Meteo (no API key). Data by Open-Meteo.com, CC BY 4.0; attribution is
//! shown in the widget details and About.
//!
//! These are the only network calls the app makes besides the update check (MASTER_SPEC 9.4),
//! and they only happen once the user has chosen a place.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;

const FORECAST_URL: &str = "https://api.open-meteo.com/v1/forecast";
const GEOCODE_URL: &str = "https://geocoding-api.open-meteo.com/v1/search";
const LOCATION_FILE: &str = "weather-location.json";
const CACHE_FILE: &str = "weather-cache.json";
const TIMEOUT: Duration = Duration::from_secs(10);
const MAX_SEARCH_RESULTS: u8 = 8;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub name: String,
    /// Region and country, for telling same-named places apart.
    pub detail: String,
    pub latitude: f64,
    pub longitude: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WeatherData {
    pub place: String,
    pub temperature_c: f64,
    pub high_c: f64,
    pub low_c: f64,
    /// WMO weather interpretation code.
    pub code: u16,
    pub is_day: bool,
    /// Unix ms of the successful fetch.
    pub fetched_at: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum WeatherError {
    #[error("network: {0}")]
    Network(String),
    #[error("unexpected response: {0}")]
    Parse(String),
    #[error("no place chosen")]
    NoPlace,
    #[error("storage: {0}")]
    Io(#[from] std::io::Error),
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder().timeout_global(Some(TIMEOUT)).build().into()
}

fn get_json<T: for<'de> Deserialize<'de>>(url: &str, query: &[(&str, String)]) -> Result<T, WeatherError> {
    let mut req = agent().get(url);
    for (k, v) in query {
        req = req.query(*k, v);
    }
    let mut res = req.call().map_err(|e| WeatherError::Network(e.to_string()))?;
    res.body_mut().read_json::<T>().map_err(|e| WeatherError::Parse(e.to_string()))
}

#[derive(Deserialize)]
struct GeoResponse {
    #[serde(default)]
    results: Vec<GeoResult>,
}

#[derive(Deserialize)]
struct GeoResult {
    name: String,
    latitude: f64,
    longitude: f64,
    #[serde(default)]
    admin1: Option<String>,
    #[serde(default)]
    country: Option<String>,
}

/// City search for the settings UI.
pub fn search(query: &str, language: &str) -> Result<Vec<Place>, WeatherError> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let res: GeoResponse = get_json(
        GEOCODE_URL,
        &[
            ("name", trimmed.to_owned()),
            ("count", MAX_SEARCH_RESULTS.to_string()),
            ("language", language.to_owned()),
            ("format", "json".to_owned()),
        ],
    )?;
    Ok(res
        .results
        .into_iter()
        .map(|r| Place {
            detail: [r.admin1, r.country].into_iter().flatten().collect::<Vec<_>>().join(", "),
            name: r.name,
            latitude: r.latitude,
            longitude: r.longitude,
        })
        .collect())
}

#[derive(Deserialize)]
struct ForecastResponse {
    current: Current,
    daily: Daily,
}

#[derive(Deserialize)]
struct Current {
    temperature_2m: f64,
    weather_code: u16,
    is_day: u8,
}

#[derive(Deserialize)]
struct Daily {
    temperature_2m_max: Vec<f64>,
    temperature_2m_min: Vec<f64>,
}

pub fn fetch(place: &Place, now_ms: u64) -> Result<WeatherData, WeatherError> {
    let res: ForecastResponse = get_json(
        FORECAST_URL,
        &[
            ("latitude", place.latitude.to_string()),
            ("longitude", place.longitude.to_string()),
            ("current", "temperature_2m,weather_code,is_day".to_owned()),
            ("daily", "temperature_2m_max,temperature_2m_min".to_owned()),
            ("timezone", "auto".to_owned()),
            ("forecast_days", "1".to_owned()),
        ],
    )?;
    let first = |v: &[f64]| v.first().copied().ok_or_else(|| WeatherError::Parse("empty daily series".into()));
    Ok(WeatherData {
        place: place.name.clone(),
        temperature_c: res.current.temperature_2m,
        high_c: first(&res.daily.temperature_2m_max)?,
        low_c: first(&res.daily.temperature_2m_min)?,
        code: res.current.weather_code,
        is_day: res.current.is_day == 1,
        fetched_at: now_ms,
    })
}

fn data_file(name: &str) -> Option<PathBuf> {
    crate::app_data_dir().map(|d| d.join(name))
}

fn read_file<T: for<'de> Deserialize<'de>>(name: &str) -> Option<T> {
    serde_json::from_str(&std::fs::read_to_string(data_file(name)?).ok()?).ok()
}

/// Atomic write: a crash mid-write never leaves a half file behind.
fn write_file<T: Serialize>(name: &str, value: &T) -> Result<(), WeatherError> {
    let path = data_file(name).ok_or(WeatherError::NoPlace)?;
    let tmp = path.with_extension("tmp");
    let json = serde_json::to_vec(value).map_err(|e| WeatherError::Parse(e.to_string()))?;
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

pub fn saved_place() -> Option<Place> {
    read_file(LOCATION_FILE)
}

pub fn save_place(place: &Place) -> Result<(), WeatherError> {
    write_file(LOCATION_FILE, place)
}

/// Last good reading, shown instantly at boot (marked stale by the UI until refreshed).
pub fn cached() -> Option<WeatherData> {
    read_file(CACHE_FILE)
}

pub fn store_cache(data: &WeatherData) -> Result<(), WeatherError> {
    write_file(CACHE_FILE, data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_open_meteo_forecast_shape() {
        let body = r#"{"current":{"time":"2026-11-19T14:30","temperature_2m":23.5,"weather_code":0,"is_day":1},
            "daily":{"time":["2026-11-19"],"temperature_2m_max":[23.5],"temperature_2m_min":[14.2]}}"#;
        let r: ForecastResponse = serde_json::from_str(body).expect("forecast fixture parses");
        assert_eq!(r.current.weather_code, 0);
        assert_eq!(r.daily.temperature_2m_min, vec![14.2]);
    }

    #[test]
    fn geocoding_without_results_is_empty_not_an_error() {
        let r: GeoResponse = serde_json::from_str(r#"{"generationtime_ms":0.1}"#).expect("empty geocode parses");
        assert!(r.results.is_empty());
    }
}
