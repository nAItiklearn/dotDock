//! Encryption at rest for the optional clipboard cache: Windows DPAPI, bound to this user account on this PC.
//! Nobody else, not even an administrator reading the disk elsewhere, can decrypt the file without the user's login.

use windows::core::PCWSTR;
use windows::Win32::Foundation::{LocalFree, HLOCAL};
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

/// A label stored with the blob, shown by tools that inspect DPAPI data.
const DESCRIPTION: &str = "dotDock clipboard history";

fn blob(bytes: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB { cbData: bytes.len() as u32, pbData: bytes.as_ptr() as *mut u8 }
}

fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
    // SAFETY: DPAPI allocated `cbData` bytes at `pbData` with LocalAlloc; they are copied then freed.
    unsafe {
        let data = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(out.pbData.cast())));
        data
    }
}

pub fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
    let input = blob(plain);
    let mut out = CRYPT_INTEGER_BLOB::default();
    let description = crate::com::wide(DESCRIPTION);
    // SAFETY: `input` points at `plain`, which outlives the call; `out` is filled by the call.
    unsafe {
        CryptProtectData(&input, PCWSTR(description.as_ptr()), None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
    }
    .map_err(|e| format!("could not encrypt the clipboard cache: {e}"))?;
    Ok(take(out))
}

pub fn unprotect(sealed: &[u8]) -> Result<Vec<u8>, String> {
    let input = blob(sealed);
    let mut out = CRYPT_INTEGER_BLOB::default();
    // SAFETY: as in `protect`.
    unsafe { CryptUnprotectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out) }
        .map_err(|e| format!("could not decrypt the clipboard cache: {e}"))?;
    Ok(take(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_round_trips_and_is_not_stored_in_the_clear() {
        let secret = b"the quick brown fox jumps over the lazy dog";
        let sealed = protect(secret).unwrap();
        assert!(!sealed.windows(secret.len()).any(|w| w == secret), "ciphertext must not contain the plain text");
        assert_eq!(unprotect(&sealed).unwrap(), secret);
    }

    #[test]
    fn garbage_does_not_decrypt() {
        assert!(unprotect(b"definitely not a DPAPI blob").is_err());
    }
}
