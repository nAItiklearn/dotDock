//! The file shelf: a short list of files and folders held for later, kept in `shelf.json`. The shelf stores paths
//! only; the files stay where they are. Dragging in and out is handled by the dock window; this is the list.

use crate::clock::now_ms;
use crate::emit::{lock, Emitter};
use crate::paths;
use crate::protocol::{ShelfItem, ShelfState, TileData};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The shelf is a holding area, not an archive.
pub const MAX_ITEMS: usize = 40;

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
struct Saved {
    id: String,
    path: String,
    added_ms: i64,
}

pub struct Shelf {
    file: PathBuf,
    emitter: Emitter,
    items: Mutex<Vec<Saved>>,
}

fn same_path(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

impl Shelf {
    pub fn new(file: PathBuf, emitter: Emitter) -> Self {
        let items = paths::read_json::<Vec<Saved>>(&file).unwrap_or_default();
        Self { file, emitter, items: Mutex::new(items) }
    }

    fn save(&self, items: &[Saved]) -> Result<(), String> {
        paths::write_json(&self.file, &items)
    }

    pub fn state(&self) -> ShelfState {
        let items = lock(&self.items);
        ShelfState {
            items: items
                .iter()
                .map(|s| {
                    let path = Path::new(&s.path);
                    ShelfItem {
                        id: s.id.clone(),
                        path: s.path.clone(),
                        name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| s.path.clone()),
                        added_ms: s.added_ms,
                        exists: path.exists(),
                        is_dir: path.is_dir(),
                    }
                })
                .collect(),
        }
    }

    fn publish(&self) {
        self.emitter.emit(TileData::Shelf(self.state()));
    }

    /// Adds files and folders, newest first. A path already on the shelf moves to the top; ones that do not exist
    /// are skipped. Returns how many were added or moved.
    pub fn add(&self, new_paths: &[String]) -> Result<usize, String> {
        let mut items = lock(&self.items);
        let before = items.clone();
        let mut changed = 0;
        for p in new_paths {
            if !Path::new(p).is_absolute() || !Path::new(p).exists() {
                continue;
            }
            items.retain(|s| !same_path(&s.path, p));
            let id = format!("{:x}-{}", now_ms(), items.len());
            items.insert(0, Saved { id, path: p.clone(), added_ms: now_ms() });
            changed += 1;
        }
        items.truncate(MAX_ITEMS);
        if *items != before {
            if let Err(e) = self.save(&items) {
                *items = before;
                return Err(e);
            }
            drop(items);
            self.publish();
        }
        Ok(changed)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let mut items = lock(&self.items);
        let before = items.clone();
        items.retain(|s| s.id != id);
        if *items != before {
            if let Err(e) = self.save(&items) {
                *items = before;
                return Err(e);
            }
            drop(items);
            self.publish();
        }
        Ok(())
    }

    pub fn clear(&self) -> Result<(), String> {
        let mut items = lock(&self.items);
        if items.is_empty() {
            return Ok(());
        }
        let before = std::mem::take(&mut *items);
        if let Err(e) = self.save(&items) {
            *items = before;
            return Err(e);
        }
        drop(items);
        self.publish();
        Ok(())
    }

    /// True when `path` is a file currently on the shelf (so "open" and "show in folder" may act on it).
    pub fn contains(&self, path: &str) -> bool {
        lock(&self.items).iter().any(|s| same_path(&s.path, path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::mpsc::channel;

    fn shelf_in(dir: &Path) -> (Shelf, std::sync::mpsc::Receiver<TileData>) {
        let (tx, rx) = channel();
        let emitter = Emitter::new(move |d| {
            let _ = tx.send(d);
        });
        (Shelf::new(dir.join("shelf.json"), emitter), rx)
    }

    fn file(dir: &Path, name: &str) -> String {
        let p = dir.join(name);
        fs::write(&p, b"x").unwrap();
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn files_are_added_newest_first_and_survive_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let (shelf, rx) = shelf_in(dir.path());
        let a = file(dir.path(), "a.txt");
        let b = file(dir.path(), "b.txt");
        assert_eq!(shelf.add(&[a.clone()]).unwrap(), 1);
        assert_eq!(shelf.add(&[b.clone()]).unwrap(), 1);
        let names: Vec<_> = shelf.state().items.iter().map(|i| i.name.clone()).collect();
        assert_eq!(names, ["b.txt", "a.txt"]);
        assert!(matches!(rx.try_iter().last(), Some(TileData::Shelf(_))));
        let (again, _) = shelf_in(dir.path());
        assert_eq!(again.state().items.len(), 2);
    }

    #[test]
    fn the_same_file_twice_moves_to_the_top() {
        let dir = tempfile::tempdir().unwrap();
        let (shelf, _rx) = shelf_in(dir.path());
        let a = file(dir.path(), "a.txt");
        let b = file(dir.path(), "b.txt");
        shelf.add(&[a.clone(), b]).unwrap();
        // Windows paths are case-insensitive, so the same file spelled differently is still one entry.
        shelf.add(&[a.to_uppercase()]).unwrap();
        let state = shelf.state();
        assert_eq!(state.items.len(), 2);
        assert!(state.items[0].name.eq_ignore_ascii_case("a.txt"));
    }

    #[test]
    fn missing_and_relative_paths_are_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let (shelf, _rx) = shelf_in(dir.path());
        let gone = dir.path().join("nothing.txt").to_string_lossy().into_owned();
        assert_eq!(shelf.add(&[gone, "relative.txt".to_owned()]).unwrap(), 0);
        assert!(shelf.state().items.is_empty());
    }

    #[test]
    fn a_file_deleted_later_is_flagged_not_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let (shelf, _rx) = shelf_in(dir.path());
        let a = file(dir.path(), "a.txt");
        shelf.add(&[a.clone()]).unwrap();
        fs::remove_file(&a).unwrap();
        let state = shelf.state();
        assert_eq!(state.items.len(), 1);
        assert!(!state.items[0].exists);
    }

    #[test]
    fn remove_clear_and_the_cap_work() {
        let dir = tempfile::tempdir().unwrap();
        let (shelf, _rx) = shelf_in(dir.path());
        let paths: Vec<String> = (0..MAX_ITEMS + 3).map(|i| file(dir.path(), &format!("f{i}.txt"))).collect();
        shelf.add(&paths).unwrap();
        assert_eq!(shelf.state().items.len(), MAX_ITEMS);
        let id = shelf.state().items[0].id.clone();
        shelf.remove(&id).unwrap();
        assert_eq!(shelf.state().items.len(), MAX_ITEMS - 1);
        shelf.clear().unwrap();
        assert!(shelf.state().items.is_empty());
        assert!(shelf.contains(&paths[0]) == false);
    }
}
