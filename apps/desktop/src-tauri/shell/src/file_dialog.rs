//! The standard Windows "Open" dialog, for picking a picture to import as a wallpaper.

use crate::wallpaper_library::IMAGE_EXTENSIONS;
use std::path::PathBuf;
use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Foundation::{ERROR_CANCELLED, HWND};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::Common::COMDLG_FILTERSPEC;
use windows::Win32::UI::Shell::{
    FileOpenDialog, IFileOpenDialog, FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM, SIGDN_FILESYSPATH,
};

/// "*.jpg;*.jpeg;…", the pattern the dialog's file-type filter takes.
pub fn image_pattern() -> String {
    IMAGE_EXTENSIONS.iter().map(|e| format!("*.{e}")).collect::<Vec<_>>().join(";")
}

/// Shows the dialog over `owner` and returns the chosen file, or None when the user cancels.
/// Runs its own COM apartment, so call it from a worker thread, never the UI thread.
pub fn pick_image(owner: Option<isize>, title: &str) -> windows::core::Result<Option<PathBuf>> {
    // SAFETY: COM is initialised for this thread and torn down below; every interface is released on drop.
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
        let result = (|| {
            let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
            let label = HSTRING::from("Pictures");
            let pattern = HSTRING::from(image_pattern());
            let filters = [COMDLG_FILTERSPEC { pszName: PCWSTR(label.as_ptr()), pszSpec: PCWSTR(pattern.as_ptr()) }];
            dialog.SetFileTypes(&filters)?;
            dialog.SetTitle(&HSTRING::from(title))?;
            dialog.SetOptions(dialog.GetOptions()? | FOS_FILEMUSTEXIST | FOS_FORCEFILESYSTEM)?;
            let parent = owner.map(|h| HWND(h as *mut core::ffi::c_void));
            match dialog.Show(parent) {
                Ok(()) => {}
                Err(e) if e.code() == ERROR_CANCELLED.to_hresult() => return Ok(None),
                Err(e) => return Err(e),
            }
            let item = dialog.GetResult()?;
            let raw = item.GetDisplayName(SIGDN_FILESYSPATH)?;
            let path = raw.to_string().map_err(|_| windows::core::Error::from_thread());
            CoTaskMemFree(Some(raw.0 as *const _));
            Ok(Some(PathBuf::from(path?)))
        })();
        CoUninitialize();
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_filter_lists_every_importable_type() {
        let pattern = image_pattern();
        assert!(pattern.starts_with("*.jpg;"));
        assert_eq!(pattern.split(';').count(), IMAGE_EXTENSIONS.len());
    }
}
