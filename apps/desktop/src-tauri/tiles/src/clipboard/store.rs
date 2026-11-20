//! The clipboard history itself: what is kept, what is dropped, and in what order. Pure data, no Windows calls.

use crate::image;
use crate::protocol::{ClipEntry, ClipKind, ClipboardState};
use serde::{Deserialize, Serialize};

/// Unpinned entries kept; older ones are dropped. Pinned entries are exempt.
pub const MAX_UNPINNED: usize = 50;
/// Memory ceiling for all entries together.
pub const MAX_BYTES: usize = 64 * 1024 * 1024;
/// Text longer than this is not recorded (a pasted file, not a snippet).
pub const MAX_TEXT_CHARS: usize = 1_000_000;
/// Images larger than this are not recorded.
pub const MAX_IMAGE_BYTES: usize = 32 * 1024 * 1024;
/// Characters of text shown in the list.
const PREVIEW_CHARS: usize = 200;
/// Longest side of an image thumbnail, in pixels.
const THUMB_SIDE: u32 = 160;

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Content {
    Text(String),
    /// A packed DIB exactly as Windows gave it, so pasting it back loses nothing.
    Image {
        dib: Vec<u8>,
        width: u32,
        height: u32,
    },
}

impl Content {
    fn cost(&self) -> usize {
        match self {
            Content::Text(t) => t.len(),
            Content::Image { dib, .. } => dib.len(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct Entry {
    pub id: u64,
    pub at_ms: i64,
    pub content: Content,
    pub pinned: bool,
    pub source: Option<String>,
    thumbnail: Option<String>,
}

pub struct Store {
    /// Newest first.
    entries: Vec<Entry>,
    next_id: u64,
}

/// What the on-disk cache holds for one entry.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    at_ms: i64,
    pinned: bool,
    source: Option<String>,
    text: Option<String>,
    dib: Option<String>,
}

fn make_thumbnail(dib: &[u8]) -> Option<String> {
    let info = image::parse_dib(dib)?;
    let rgba = image::dib_to_rgba(&info, dib);
    let (small, w, h) = image::thumbnail(&rgba, info.width, info.height, THUMB_SIDE);
    image::encode_png(&small, w, h).ok().map(|png| image::png_data_url(&png))
}

impl Default for Store {
    fn default() -> Self {
        Self::new()
    }
}

impl Store {
    pub fn new() -> Self {
        Self { entries: Vec::new(), next_id: 1 }
    }

    fn total_bytes(&self) -> usize {
        self.entries.iter().map(|e| e.content.cost()).sum()
    }

    /// Records a copy. Returns false when it changed nothing (empty, too large, or identical to the newest entry).
    pub fn add(&mut self, content: Content, at_ms: i64, source: Option<String>) -> bool {
        match &content {
            Content::Text(t) if t.trim().is_empty() || t.chars().count() > MAX_TEXT_CHARS => return false,
            Content::Image { dib, .. } if dib.len() > MAX_IMAGE_BYTES => return false,
            _ => {}
        }
        if self.entries.first().is_some_and(|e| e.content == content) {
            return false;
        }
        // The same content copied again moves to the top instead of piling up.
        let (pinned, thumbnail) = match self.entries.iter().position(|e| e.content == content) {
            Some(i) => {
                let old = self.entries.remove(i);
                (old.pinned, old.thumbnail)
            }
            None => (
                false,
                match &content {
                    Content::Image { dib, .. } => make_thumbnail(dib),
                    Content::Text(_) => None,
                },
            ),
        };
        let id = self.next_id;
        self.next_id += 1;
        self.entries.insert(0, Entry { id, at_ms, content, pinned, source, thumbnail });
        self.evict();
        true
    }

    fn evict(&mut self) {
        while self.entries.iter().filter(|e| !e.pinned).count() > MAX_UNPINNED || self.total_bytes() > MAX_BYTES {
            match self.entries.iter().rposition(|e| !e.pinned) {
                Some(i) => {
                    self.entries.remove(i);
                }
                None => break,
            }
        }
    }

    pub fn get(&self, id: u64) -> Option<&Entry> {
        self.entries.iter().find(|e| e.id == id)
    }

    /// Moves an entry to the top, as if it had just been copied.
    pub fn touch(&mut self, id: u64, at_ms: i64) -> bool {
        match self.entries.iter().position(|e| e.id == id) {
            Some(i) => {
                let mut entry = self.entries.remove(i);
                entry.at_ms = at_ms;
                self.entries.insert(0, entry);
                true
            }
            None => false,
        }
    }

    pub fn pin(&mut self, id: u64, pinned: bool) -> bool {
        match self.entries.iter_mut().find(|e| e.id == id) {
            Some(e) if e.pinned != pinned => {
                e.pinned = pinned;
                true
            }
            _ => false,
        }
    }

    pub fn remove(&mut self, id: u64) -> bool {
        let before = self.entries.len();
        self.entries.retain(|e| e.id != id);
        self.entries.len() != before
    }

    /// Drops everything that is not pinned.
    pub fn clear(&mut self) -> bool {
        let before = self.entries.len();
        self.entries.retain(|e| e.pinned);
        self.entries.len() != before
    }

    pub fn state(&self, persisted: bool) -> ClipboardState {
        ClipboardState { entries: self.entries.iter().map(to_wire).collect(), persisted }
    }

    pub fn to_saved(&self) -> Vec<Saved> {
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD;
        // Oldest first, so loading in order rebuilds the same ranking.
        self.entries
            .iter()
            .rev()
            .map(|e| Saved {
                at_ms: e.at_ms,
                pinned: e.pinned,
                source: e.source.clone(),
                text: match &e.content {
                    Content::Text(t) => Some(t.clone()),
                    Content::Image { .. } => None,
                },
                dib: match &e.content {
                    Content::Image { dib, .. } => Some(b64.encode(dib)),
                    Content::Text(_) => None,
                },
            })
            .collect()
    }

    pub fn from_saved(saved: Vec<Saved>) -> Self {
        use base64::Engine;
        let mut store = Self::new();
        for s in saved {
            let content = match (s.text, s.dib) {
                (Some(t), _) => Content::Text(t),
                (None, Some(d)) => match base64::engine::general_purpose::STANDARD.decode(d).ok().and_then(|dib| {
                    let info = image::parse_dib(&dib)?;
                    Some(Content::Image { width: info.width, height: info.height, dib })
                }) {
                    Some(c) => c,
                    None => continue,
                },
                (None, None) => continue,
            };
            if store.add(content, s.at_ms, s.source) {
                store.pin(store.next_id - 1, s.pinned);
            }
        }
        store
    }
}

fn to_wire(e: &Entry) -> ClipEntry {
    match &e.content {
        Content::Text(t) => ClipEntry {
            id: e.id,
            at_ms: e.at_ms,
            kind: ClipKind::Text,
            preview: preview(t),
            size: t.chars().count() as u64,
            pinned: e.pinned,
            thumbnail: None,
            source: e.source.clone(),
        },
        Content::Image { width, height, .. } => ClipEntry {
            id: e.id,
            at_ms: e.at_ms,
            kind: ClipKind::Image,
            preview: format!("Image {width} x {height}"),
            size: u64::from(*width) * u64::from(*height),
            pinned: e.pinned,
            thumbnail: e.thumbnail.clone(),
            source: e.source.clone(),
        },
    }
}

fn preview(text: &str) -> String {
    let collapsed: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(PREVIEW_CHARS).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(s: &str) -> Content {
        Content::Text(s.to_owned())
    }

    fn tiny_dib() -> Content {
        let mut d = Vec::new();
        d.extend_from_slice(&40u32.to_le_bytes());
        d.extend_from_slice(&1i32.to_le_bytes());
        d.extend_from_slice(&1i32.to_le_bytes());
        d.extend_from_slice(&1u16.to_le_bytes());
        d.extend_from_slice(&24u16.to_le_bytes());
        d.extend_from_slice(&[0u8; 24]);
        d.extend_from_slice(&[1, 2, 3, 0]);
        Content::Image { dib: d, width: 1, height: 1 }
    }

    #[test]
    fn newest_first_and_identical_copies_do_not_repeat() {
        let mut s = Store::new();
        assert!(s.add(text("one"), 1, None));
        assert!(s.add(text("two"), 2, None));
        assert!(!s.add(text("two"), 3, None), "same as newest");
        assert!(s.add(text("one"), 4, None), "an older entry moves to the top");
        let state = s.state(false);
        assert_eq!(state.entries.iter().map(|e| e.preview.as_str()).collect::<Vec<_>>(), ["one", "two"]);
    }

    #[test]
    fn blank_and_oversized_text_is_ignored() {
        let mut s = Store::new();
        assert!(!s.add(text("   \n"), 1, None));
        assert!(!s.add(Content::Text("x".repeat(MAX_TEXT_CHARS + 1)), 1, None));
        assert!(s.state(false).entries.is_empty());
    }

    #[test]
    fn the_oldest_unpinned_entry_goes_first() {
        let mut s = Store::new();
        s.add(text("keep me"), 0, None);
        s.pin(1, true);
        for i in 0..MAX_UNPINNED + 5 {
            s.add(text(&format!("item {i}")), i as i64 + 1, None);
        }
        let entries = s.state(false).entries;
        assert_eq!(entries.iter().filter(|e| !e.pinned).count(), MAX_UNPINNED);
        assert!(entries.iter().any(|e| e.preview == "keep me"), "pinned entries stay");
        assert!(!entries.iter().any(|e| e.preview == "item 0"), "the oldest unpinned entry was dropped");
    }

    #[test]
    fn clear_keeps_pinned_entries() {
        let mut s = Store::new();
        s.add(text("a"), 1, None);
        s.add(text("b"), 2, None);
        s.pin(2, true);
        assert!(s.clear());
        assert_eq!(s.state(false).entries.len(), 1);
        assert!(!s.clear());
    }

    #[test]
    fn images_get_a_thumbnail_and_a_size_line() {
        let mut s = Store::new();
        assert!(s.add(tiny_dib(), 1, Some("Paint".into())));
        let e = &s.state(false).entries[0];
        assert_eq!(e.kind, ClipKind::Image);
        assert_eq!(e.preview, "Image 1 x 1");
        assert!(e.thumbnail.as_deref().is_some_and(|t| t.starts_with("data:image/png;base64,")));
        assert_eq!(e.source.as_deref(), Some("Paint"));
    }

    #[test]
    fn the_saved_form_round_trips() {
        let mut s = Store::new();
        s.add(text("first"), 1, None);
        s.add(tiny_dib(), 2, Some("Paint".into()));
        s.add(text("third"), 3, None);
        s.pin(1, true);
        let saved = s.to_saved();
        let json = serde_json::to_string(&saved).unwrap();
        let back = Store::from_saved(serde_json::from_str(&json).unwrap());
        let a: Vec<_> = s.state(true).entries.iter().map(|e| (e.preview.clone(), e.pinned)).collect();
        let b: Vec<_> = back.state(true).entries.iter().map(|e| (e.preview.clone(), e.pinned)).collect();
        assert_eq!(a, b);
    }

    #[test]
    fn whitespace_in_previews_is_collapsed() {
        assert_eq!(preview("a \n\t b   c"), "a b c");
    }
}
