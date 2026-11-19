//! The company name stamped into an executable's version resource, used as the publisher of desktop apps.

use crate::com::{from_wide, pcwstr, wide};
use windows::core::w;
use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};

/// Language and code page pairs tried when the file lists none of its own (US English, Unicode and ANSI,
/// then language neutral). The file's own translation table is always tried first.
const FALLBACK_TRANSLATIONS: [(u16, u16); 3] = [(0x0409, 0x04b0), (0x0409, 0x04e4), (0x0000, 0x04b0)];

pub fn company_name(path: &str) -> Option<String> {
    let file = wide(path);
    // SAFETY: the version block is a plain byte buffer we own; `VerQueryValueW` returns pointers into it
    // that are copied out before the buffer is dropped.
    unsafe {
        let size = GetFileVersionInfoSizeW(pcwstr(&file), None);
        if size == 0 {
            return None;
        }
        let mut block = vec![0u8; size as usize];
        GetFileVersionInfoW(pcwstr(&file), None, size, block.as_mut_ptr().cast()).ok()?;

        let mut translations: Vec<(u16, u16)> = Vec::new();
        let mut ptr: *mut core::ffi::c_void = std::ptr::null_mut();
        let mut len = 0u32;
        if VerQueryValueW(block.as_ptr().cast(), w!("\\VarFileInfo\\Translation"), &mut ptr, &mut len).as_bool()
            && !ptr.is_null()
        {
            let pairs = std::slice::from_raw_parts(ptr.cast::<u16>(), len as usize / size_of::<u16>());
            translations.extend(pairs.as_chunks::<2>().0.iter().map(|p| (p[0], p[1])));
        }
        translations.extend(FALLBACK_TRANSLATIONS);

        for (lang, page) in translations {
            let query = wide(&format!("\\StringFileInfo\\{lang:04x}{page:04x}\\CompanyName"));
            let mut text: *mut core::ffi::c_void = std::ptr::null_mut();
            let mut chars = 0u32;
            if VerQueryValueW(block.as_ptr().cast(), pcwstr(&query), &mut text, &mut chars).as_bool()
                && !text.is_null()
                && chars > 0
            {
                let utf16 = std::slice::from_raw_parts(text.cast::<u16>(), chars as usize);
                let name = from_wide(utf16).trim().to_owned();
                if !name.is_empty() {
                    return Some(name);
                }
            }
        }
        None
    }
}
