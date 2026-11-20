//! The dock's wire types. A one-to-one mirror of `apps/desktop/src/dock/protocol.ts` with serde
//! `rename_all = "camelCase"`. Changing a type here is a breaking change for the dock window: change
//! `protocol.ts` and `docs/dock/CONTRACT.md` in the same commit.

use serde::{de, Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;

/// Prefix of a user-made category id (`custom:<uuid>`).
pub const CUSTOM_PREFIX: &str = "custom:";

/// The categories every install starts with, in their default order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Builtin {
    Productivity,
    Communication,
    Development,
    Ai,
    Creative,
    Browsers,
    Media,
    Games,
    Utilities,
    System,
    Other,
}

impl Builtin {
    pub const ALL: [Builtin; 11] = [
        Builtin::Productivity,
        Builtin::Communication,
        Builtin::Development,
        Builtin::Ai,
        Builtin::Creative,
        Builtin::Browsers,
        Builtin::Media,
        Builtin::Games,
        Builtin::Utilities,
        Builtin::System,
        Builtin::Other,
    ];

    /// The id on the wire.
    pub const fn as_str(self) -> &'static str {
        match self {
            Builtin::Productivity => "productivity",
            Builtin::Communication => "communication",
            Builtin::Development => "development",
            Builtin::Ai => "ai",
            Builtin::Creative => "creative",
            Builtin::Browsers => "browsers",
            Builtin::Media => "media",
            Builtin::Games => "games",
            Builtin::Utilities => "utilities",
            Builtin::System => "system",
            Builtin::Other => "other",
        }
    }

    pub fn parse(id: &str) -> Option<Builtin> {
        Builtin::ALL.into_iter().find(|b| b.as_str() == id)
    }

    /// Tone the category's stack is tinted with by default.
    pub const fn default_tone(self) -> CategoryTone {
        match self {
            Builtin::Productivity => CategoryTone::Amber,
            Builtin::Communication => CategoryTone::Green,
            Builtin::Development => CategoryTone::Blue,
            Builtin::Ai => CategoryTone::Violet,
            Builtin::Creative => CategoryTone::Pink,
            Builtin::Browsers => CategoryTone::Teal,
            Builtin::Media => CategoryTone::Red,
            Builtin::Games => CategoryTone::Accent,
            Builtin::Utilities => CategoryTone::Neutral,
            Builtin::System => CategoryTone::Neutral,
            Builtin::Other => CategoryTone::Neutral,
        }
    }
}

/// A built-in category or `custom:<id>`. Validated on every deserialisation, so a hand-edited store cannot
/// smuggle in an id the UI has no way to render.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct CategoryId(String);

impl CategoryId {
    pub fn parse(id: &str) -> Option<CategoryId> {
        let ok = Builtin::parse(id).is_some() || id.strip_prefix(CUSTOM_PREFIX).is_some_and(|rest| !rest.is_empty());
        ok.then(|| CategoryId(id.to_owned()))
    }

    pub fn custom(unique: &str) -> Option<CategoryId> {
        CategoryId::parse(&format!("{CUSTOM_PREFIX}{unique}"))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The built-in this id names, or `None` for a custom category.
    pub fn builtin(&self) -> Option<Builtin> {
        Builtin::parse(&self.0)
    }
}

impl From<Builtin> for CategoryId {
    fn from(b: Builtin) -> Self {
        CategoryId(b.as_str().to_owned())
    }
}

impl fmt::Display for CategoryId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl Serialize for CategoryId {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for CategoryId {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(d)?;
        CategoryId::parse(&raw).ok_or_else(|| de::Error::custom(format!("unknown category id `{raw}`")))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CategoryTone {
    Accent,
    Red,
    Amber,
    Green,
    Teal,
    Blue,
    Violet,
    Pink,
    Neutral,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: CategoryId,
    /// Display name; `None` means the UI localises the built-in name from the id.
    pub name: Option<String>,
    pub tone: CategoryTone,
    /// Position among stacks, lowest first.
    pub order: u32,
}

impl Category {
    /// The eleven built-in categories, in their default order and tones.
    pub fn defaults() -> Vec<Category> {
        Builtin::ALL
            .into_iter()
            .enumerate()
            .map(|(i, b)| Category { id: b.into(), name: None, tone: b.default_tone(), order: i as u32 })
            .collect()
    }
}

/// How an app was put in its category.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FiledBy {
    User,
    Known,
    Store,
    Rule,
    Fallback,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockApp {
    pub id: String,
    pub name: String,
    pub category: CategoryId,
    pub filed_by: FiledBy,
    /// `dock-icon://<hash>.png` as the backend names it; the host turns it into `http://dock-icon.localhost/...` for the window.
    pub icon: String,
    pub publisher: Option<String>,
    /// Epoch ms the app was first seen.
    pub first_seen: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockWindow {
    /// HWND as a decimal string.
    pub hwnd: String,
    pub app_id: Option<String>,
    pub title: String,
    pub icon: String,
    pub minimized: bool,
    pub focused: bool,
    pub flashing: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DockEdge {
    Bottom,
    Top,
    Left,
    Right,
}

/// The settings schema version; anything else fails to load, so a newer file is never half-understood.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SchemaV1;

impl Serialize for SchemaV1 {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_u8(1)
    }
}

impl<'de> Deserialize<'de> for SchemaV1 {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        match u8::deserialize(d)? {
            1 => Ok(SchemaV1),
            other => Err(de::Error::custom(format!("unsupported dock settings schema {other}"))),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockSettings {
    pub schema: SchemaV1,
    pub enabled: bool,
    pub replace_taskbar: bool,
    pub edge: DockEdge,
    pub reserve_space: bool,
    pub auto_hide: bool,
    pub icon_size: u32,
    pub magnification: f64,
    pub pinned: Vec<PinnedItem>,
    pub tiles: Vec<String>,
}

/// Icon size at 100 % scaling and peak magnification of a fresh install. The UI track owns the look; these
/// are the starting values that the settings page then lets the user change.
pub const DEFAULT_ICON_SIZE: u32 = 48;
pub const DEFAULT_MAGNIFICATION: f64 = 1.6;

impl DockSettings {
    /// Rejects values the dock cannot draw: no icon size, or a magnification that is not a number or shrinks.
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.icon_size == 0 {
            return Err("the icon size must be above zero");
        }
        if !self.magnification.is_finite() || self.magnification < 1.0 {
            return Err("magnification must be 1 (off) or more");
        }
        Ok(())
    }
}

impl Default for DockSettings {
    fn default() -> Self {
        DockSettings {
            schema: SchemaV1,
            enabled: true,
            replace_taskbar: false,
            edge: DockEdge::Bottom,
            reserve_space: true,
            auto_hide: false,
            icon_size: DEFAULT_ICON_SIZE,
            magnification: DEFAULT_MAGNIFICATION,
            pinned: Vec::new(),
            tiles: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PinnedItem {
    App { id: String },
    Stack { category: CategoryId },
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockSnapshot {
    pub categories: Vec<Category>,
    pub apps: Vec<DockApp>,
    pub windows: Vec<DockWindow>,
    pub settings: DockSettings,
}

/// A rectangle in CSS px relative to the dock window.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// `dock_preview` arguments: show thumbnails for `hwnds` above `anchor`, or hide them when `hwnds` is empty.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PreviewArgs {
    pub hwnds: Vec<String>,
    #[serde(default)]
    pub anchor: Option<Rect>,
}

/// What every command resolves with: `{ ok: true }` or `{ ok: false, reason }`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommandResult {
    Ok,
    Failed { reason: String },
}

impl CommandResult {
    pub fn failed(reason: impl Into<String>) -> Self {
        CommandResult::Failed { reason: reason.into() }
    }

    pub fn is_ok(&self) -> bool {
        matches!(self, CommandResult::Ok)
    }
}

impl<E: fmt::Display> From<Result<(), E>> for CommandResult {
    fn from(r: Result<(), E>) -> Self {
        match r {
            Ok(()) => CommandResult::Ok,
            Err(e) => CommandResult::failed(e.to_string()),
        }
    }
}

impl Serialize for CommandResult {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        match self {
            CommandResult::Ok => {
                let mut m = s.serialize_map(Some(1))?;
                m.serialize_entry("ok", &true)?;
                m.end()
            }
            CommandResult::Failed { reason } => {
                let mut m = s.serialize_map(Some(2))?;
                m.serialize_entry("ok", &false)?;
                m.serialize_entry("reason", reason)?;
                m.end()
            }
        }
    }
}

/// Event names the core emits to the dock window.
pub const EVENT_APPS: &str = "dock://apps";
pub const EVENT_WINDOWS: &str = "dock://windows";
pub const EVENT_SETTINGS: &str = "dock://settings";
/// The App Library's global shortcut was pressed (payload `"toggle"`).
pub const EVENT_LIBRARY: &str = "dock://library";
/// The cursor entered or left the rectangles from `dock_set_regions` (payload `{ "inside": bool }`).
pub const EVENT_POINTER: &str = "dock://pointer";
pub use crate::frozen::EVENT_FROZEN;

/// One event for the dock window; `name()` and the serialised payload are what the host emits.
#[derive(Clone, Debug, PartialEq)]
pub enum DockEvent {
    Apps(Vec<DockApp>),
    Windows(Vec<DockWindow>),
    Settings(DockSettings),
    Frozen(crate::frozen::FrozenState),
}

impl DockEvent {
    pub fn name(&self) -> &'static str {
        match self {
            DockEvent::Apps(_) => EVENT_APPS,
            DockEvent::Windows(_) => EVENT_WINDOWS,
            DockEvent::Settings(_) => EVENT_SETTINGS,
            DockEvent::Frozen(_) => EVENT_FROZEN,
        }
    }

    pub fn payload(&self) -> serde_json::Value {
        match self {
            DockEvent::Apps(v) => serde_json::to_value(v),
            DockEvent::Windows(v) => serde_json::to_value(v),
            DockEvent::Settings(v) => serde_json::to_value(v),
            DockEvent::Frozen(v) => serde_json::to_value(v),
        }
        .expect("dock events are plain data and always serialise")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn category_ids_validate() {
        assert!(CategoryId::parse("ai").is_some());
        assert!(CategoryId::parse("custom:1234").is_some());
        assert!(CategoryId::parse("custom:").is_none());
        assert!(CategoryId::parse("nonsense").is_none());
        assert!(serde_json::from_value::<CategoryId>(json!("games")).is_ok());
        assert!(serde_json::from_value::<CategoryId>(json!("gamez")).is_err());
    }

    #[test]
    fn default_categories_cover_every_builtin_in_order() {
        let defaults = Category::defaults();
        assert_eq!(defaults.len(), Builtin::ALL.len());
        for (i, (c, b)) in defaults.iter().zip(Builtin::ALL).enumerate() {
            assert_eq!(c.id.as_str(), b.as_str());
            assert_eq!(c.order as usize, i);
        }
    }

    #[test]
    fn app_serialises_camel_case() {
        let app = DockApp {
            id: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App".into(),
            name: "Calculator".into(),
            category: Builtin::Utilities.into(),
            filed_by: FiledBy::Known,
            icon: "dock-icon://ab12.png".into(),
            publisher: None,
            first_seen: 1_700_000_000_000,
        };
        let v = serde_json::to_value(&app).unwrap();
        assert_eq!(v["filedBy"], "known");
        assert_eq!(v["firstSeen"], 1_700_000_000_000u64);
        assert_eq!(v["category"], "utilities");
        assert!(v["publisher"].is_null());
        assert_eq!(serde_json::from_value::<DockApp>(v).unwrap(), app);
    }

    #[test]
    fn window_serialises_camel_case() {
        let w = DockWindow {
            hwnd: "197314".into(),
            app_id: None,
            title: "Untitled".into(),
            icon: "dock-icon://x.png".into(),
            minimized: false,
            focused: true,
            flashing: false,
        };
        let v = serde_json::to_value(&w).unwrap();
        assert!(v["appId"].is_null());
        assert_eq!(v["hwnd"], "197314");
    }

    #[test]
    fn settings_match_the_typescript_shape() {
        let s = DockSettings {
            pinned: vec![
                PinnedItem::App { id: "chrome".into() },
                PinnedItem::Stack { category: Builtin::Development.into() },
            ],
            ..DockSettings::default()
        };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["schema"], 1);
        assert_eq!(v["replaceTaskbar"], false);
        assert_eq!(v["reserveSpace"], true);
        assert_eq!(v["edge"], "bottom");
        assert_eq!(v["pinned"][0], json!({ "kind": "app", "id": "chrome" }));
        assert_eq!(v["pinned"][1], json!({ "kind": "stack", "category": "development" }));
        assert_eq!(serde_json::from_value::<DockSettings>(v).unwrap(), s);
    }

    #[test]
    fn settings_the_dock_cannot_draw_are_rejected() {
        assert!(DockSettings::default().validate().is_ok());
        assert!(DockSettings { icon_size: 0, ..DockSettings::default() }.validate().is_err());
        assert!(DockSettings { magnification: 0.5, ..DockSettings::default() }.validate().is_err());
        assert!(DockSettings { magnification: f64::NAN, ..DockSettings::default() }.validate().is_err());
        assert!(DockSettings { magnification: 1.0, ..DockSettings::default() }.validate().is_ok());
    }

    #[test]
    fn newer_settings_schema_is_rejected() {
        let mut v = serde_json::to_value(DockSettings::default()).unwrap();
        v["schema"] = json!(2);
        assert!(serde_json::from_value::<DockSettings>(v).is_err());
    }

    #[test]
    fn command_result_wire_shape() {
        assert_eq!(serde_json::to_value(CommandResult::Ok).unwrap(), json!({ "ok": true }));
        assert_eq!(
            serde_json::to_value(CommandResult::failed("no such app")).unwrap(),
            json!({ "ok": false, "reason": "no such app" })
        );
    }

    #[test]
    fn preview_hide_has_no_anchor() {
        let hide: PreviewArgs = serde_json::from_value(json!({ "hwnds": [] })).unwrap();
        assert!(hide.hwnds.is_empty() && hide.anchor.is_none());
        let show: PreviewArgs =
            serde_json::from_value(json!({ "hwnds": ["12"], "anchor": { "x": 1, "y": 2, "w": 3, "h": 4 } })).unwrap();
        assert_eq!(show.anchor, Some(Rect { x: 1.0, y: 2.0, w: 3.0, h: 4.0 }));
    }

    #[test]
    fn event_names_match_the_contract() {
        assert_eq!(DockEvent::Apps(vec![]).name(), "dock://apps");
        assert_eq!(DockEvent::Windows(vec![]).name(), "dock://windows");
        assert_eq!(DockEvent::Settings(DockSettings::default()).name(), "dock://settings");
    }
}
