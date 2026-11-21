//! Incremental reader for append-only line files (Codex rollouts, the agent feed): remembers how far it has
//! read and keeps a half-written last line for the next call.

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

#[derive(Debug, Default)]
pub struct Tail {
    /// Bytes already consumed; `None` until the first read decides where a large file starts.
    offset: Option<u64>,
    partial: Vec<u8>,
}

impl Tail {
    pub fn new() -> Self {
        Self::default()
    }

    /// The complete lines appended since the previous call, oldest first. `None` when nothing new arrived or
    /// the file cannot be read.
    ///
    /// The first call starts `first_window` bytes before the end of a file larger than that, and drops the line
    /// that cut. A file that shrank (truncated or replaced) is read again from its start.
    pub fn read_lines(&mut self, path: &Path, first_window: u64) -> Option<Vec<String>> {
        let mut file = std::fs::File::open(path).ok()?;
        let size = file.metadata().ok()?.len();
        let first = self.offset.is_none();
        let mut offset = self.offset.unwrap_or_else(|| size.saturating_sub(first_window));
        if size < offset {
            offset = 0;
            self.partial.clear();
        }
        if size == offset {
            self.offset = Some(offset);
            return None;
        }
        file.seek(SeekFrom::Start(offset)).ok()?;
        let mut chunk = Vec::new();
        file.take(size - offset).read_to_end(&mut chunk).ok()?;
        self.offset = Some(size);
        let mut buffer = std::mem::take(&mut self.partial);
        buffer.extend_from_slice(&chunk);
        let complete_to = buffer.iter().rposition(|b| *b == b'\n').map_or(0, |i| i + 1);
        self.partial = buffer.split_off(complete_to);
        let text = String::from_utf8_lossy(&buffer);
        let cut_mid_line = first && size > first_window;
        Some(text.lines().skip(usize::from(cut_mid_line)).map(str::to_owned).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn append(path: &Path, text: &str) {
        let mut file = std::fs::OpenOptions::new().create(true).append(true).open(path).expect("open");
        file.write_all(text.as_bytes()).expect("write");
    }

    #[test]
    fn returns_only_new_complete_lines_and_keeps_the_half_written_one() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("log.jsonl");
        let mut tail = Tail::new();
        append(&path, "one\ntwo\nthr");
        assert_eq!(tail.read_lines(&path, 1024), Some(vec!["one".to_owned(), "two".to_owned()]));
        assert_eq!(tail.read_lines(&path, 1024), None, "nothing new");
        append(&path, "ee\nfour\n");
        assert_eq!(tail.read_lines(&path, 1024), Some(vec!["three".to_owned(), "four".to_owned()]));
    }

    #[test]
    fn a_large_file_starts_near_its_end_without_the_cut_line() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("log.jsonl");
        let lines: String = (0..200).map(|i| format!("line-{i:03}\n")).collect();
        append(&path, &lines);
        let mut tail = Tail::new();
        let read = tail.read_lines(&path, 100).expect("lines");
        assert!(read.len() < 12, "only the last window is read");
        assert_eq!(read.last().map(String::as_str), Some("line-199"));
        assert!(read.iter().all(|l| l.starts_with("line-") && l.len() == 8), "no partial line leaks in");
    }

    #[test]
    fn a_file_that_shrank_is_read_again_from_the_start() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("log.jsonl");
        append(&path, "aaaa\nbbbb\n");
        let mut tail = Tail::new();
        tail.read_lines(&path, 1024).expect("first");
        std::fs::write(&path, "cc\n").expect("replace");
        assert_eq!(tail.read_lines(&path, 1024), Some(vec!["cc".to_owned()]));
    }

    #[test]
    fn a_missing_file_is_not_an_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert_eq!(Tail::new().read_lines(&dir.path().join("none.jsonl"), 1024), None);
    }
}
