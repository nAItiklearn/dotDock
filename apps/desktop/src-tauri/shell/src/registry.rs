//! Minimal HKCU registry helpers. Scope rule: only keys under HKEY_CURRENT_USER.

use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS, WIN32_ERROR};
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, HKEY,
    HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_DWORD, REG_OPTION_NON_VOLATILE, REG_SZ, REG_VALUE_TYPE,
};

#[derive(Debug, thiserror::Error)]
#[error("registry {op} failed for {path}\\{name}: code {code}")]
pub struct RegistryError {
    op: &'static str,
    path: String,
    name: String,
    code: u32,
}

fn check(code: WIN32_ERROR, op: &'static str, path: &str, name: &str) -> Result<(), RegistryError> {
    if code == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(RegistryError { op, path: path.to_owned(), name: name.to_owned(), code: code.0 })
    }
}

struct Key(HKEY);

impl Drop for Key {
    fn drop(&mut self) {
        // SAFETY: the handle came from a successful RegOpen/RegCreate and is closed once.
        unsafe {
            let _ = RegCloseKey(self.0);
        }
    }
}

fn open(path: &str, write: bool) -> Result<Option<Key>, RegistryError> {
    let mut key = HKEY::default();
    let access = if write { KEY_READ | KEY_WRITE } else { KEY_READ };
    // SAFETY: valid HSTRING path and out-pointer to a local HKEY.
    let code = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, &HSTRING::from(path), Some(0), access, &mut key) };
    if code == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }
    check(code, "open", path, "")?;
    Ok(Some(Key(key)))
}

fn create(path: &str) -> Result<Key, RegistryError> {
    let mut key = HKEY::default();
    // SAFETY: valid HSTRING path and out-pointer to a local HKEY.
    let code = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            &HSTRING::from(path),
            None,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_READ | KEY_WRITE,
            None,
            &mut key,
            None,
        )
    };
    check(code, "create", path, "")?;
    Ok(Key(key))
}

pub fn key_exists(path: &str) -> Result<bool, RegistryError> {
    Ok(open(path, false)?.is_some())
}

/// Raw value bytes and type, or None when the key or value does not exist.
fn query(path: &str, name: &str) -> Result<Option<(REG_VALUE_TYPE, Vec<u8>)>, RegistryError> {
    let Some(key) = open(path, false)? else { return Ok(None) };
    let wname = HSTRING::from(name);
    let mut kind = REG_VALUE_TYPE::default();
    let mut len = 0u32;
    // SAFETY: first call only asks for the size.
    let code = unsafe { RegQueryValueExW(key.0, &wname, None, Some(&mut kind), None, Some(&mut len)) };
    if code == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }
    check(code, "query", path, name)?;
    let mut buf = vec![0u8; len as usize];
    // SAFETY: buf has exactly `len` bytes as reported by the previous call.
    let code =
        unsafe { RegQueryValueExW(key.0, &wname, None, Some(&mut kind), Some(buf.as_mut_ptr()), Some(&mut len)) };
    check(code, "query", path, name)?;
    buf.truncate(len as usize);
    Ok(Some((kind, buf)))
}

pub fn get_dword(path: &str, name: &str) -> Result<Option<u32>, RegistryError> {
    Ok(query(path, name)?.and_then(|(kind, b)| {
        (kind == REG_DWORD && b.len() >= 4).then(|| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }))
}

pub fn get_string(path: &str, name: &str) -> Result<Option<String>, RegistryError> {
    Ok(query(path, name)?.map(|(_, b)| {
        let wide: Vec<u16> = b.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
        String::from_utf16_lossy(&wide).trim_end_matches('\0').to_owned()
    }))
}

pub fn set_dword(path: &str, name: &str, value: u32) -> Result<(), RegistryError> {
    let key = create(path)?;
    // SAFETY: the data slice outlives the call.
    let code = unsafe { RegSetValueExW(key.0, &HSTRING::from(name), None, REG_DWORD, Some(&value.to_le_bytes())) };
    check(code, "set", path, name)
}

pub fn set_string(path: &str, name: &str, value: &str) -> Result<(), RegistryError> {
    let key = create(path)?;
    let bytes: Vec<u8> = value.encode_utf16().chain(std::iter::once(0)).flat_map(u16::to_le_bytes).collect();
    // SAFETY: the data slice outlives the call.
    let code = unsafe { RegSetValueExW(key.0, &HSTRING::from(name), None, REG_SZ, Some(&bytes)) };
    check(code, "set", path, name)
}

/// Deletes a value; a missing key or value counts as success.
pub fn delete_value(path: &str, name: &str) -> Result<(), RegistryError> {
    let Some(key) = open(path, true)? else { return Ok(()) };
    // SAFETY: open key handle and valid name.
    let code = unsafe { RegDeleteValueW(key.0, &HSTRING::from(name)) };
    if code == ERROR_FILE_NOT_FOUND {
        return Ok(());
    }
    check(code, "delete", path, name)
}
