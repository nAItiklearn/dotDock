//! Human names for executables: the `FileDescription` from the file's version resource ("Google Chrome"),
//! falling back to the file name without extension.

use crate::com::wide;
use std::collections::HashMap;
use std::ffi::c_void;
use std::path::Path;
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};

/// Remembers names by path, since reading a version resource touches the disk.
#[derive(Default)]
pub struct NameCache(HashMap<String, String>);

impl NameCache {
    pub fn name_for(&mut self, exe_path: &str) -> String {
        self.0.entry(exe_path.to_owned()).or_insert_with(|| friendly_name(exe_path)).clone()
    }
}

pub fn friendly_name(exe_path: &str) -> String {
    file_description(exe_path).filter(|d| !d.trim().is_empty()).unwrap_or_else(|| {
        Path::new(exe_path).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
    })
}

/// `FileDescription` in the file's first listed language, if it has one.
fn file_description(path: &str) -> Option<String> {
    let path_w = wide(path);
    // SAFETY: all buffers are owned here and sized by the calls that fill them; the pointers returned by
    // VerQueryValueW point inside `data`, which outlives their use.
    unsafe {
        let size = GetFileVersionInfoSizeW(PCWSTR(path_w.as_ptr()), None);
        if size == 0 {
            return None;
        }
        let mut data = vec![0u8; size as usize];
        GetFileVersionInfoW(PCWSTR(path_w.as_ptr()), None, size, data.as_mut_ptr().cast()).ok()?;

        let mut ptr: *mut c_void = std::ptr::null_mut();
        let mut len = 0u32;
        let translation = wide("\\VarFileInfo\\Translation");
        if !VerQueryValueW(data.as_ptr().cast(), PCWSTR(translation.as_ptr()), &mut ptr, &mut len).as_bool()
            || len < 4
            || ptr.is_null()
        {
            return None;
        }
        let pair = std::slice::from_raw_parts(ptr as *const u16, 2);
        let sub_block = wide(&format!("\\StringFileInfo\\{:04x}{:04x}\\FileDescription", pair[0], pair[1]));
        if !VerQueryValueW(data.as_ptr().cast(), PCWSTR(sub_block.as_ptr()), &mut ptr, &mut len).as_bool()
            || len == 0
            || ptr.is_null()
        {
            return None;
        }
        let chars = std::slice::from_raw_parts(ptr as *const u16, len as usize);
        let end = chars.iter().position(|&c| c == 0).unwrap_or(chars.len());
        Some(String::from_utf16_lossy(&chars[..end]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn describes_a_system_executable() {
        let notepad = r"C:\Windows\System32\notepad.exe";
        if Path::new(notepad).exists() {
            assert!(!friendly_name(notepad).is_empty());
        }
    }

    #[test]
    fn falls_back_to_the_file_stem() {
        assert_eq!(friendly_name(r"C:\nowhere\thing.exe"), "thing");
    }
}
