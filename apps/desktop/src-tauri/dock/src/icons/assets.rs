//! Finding the biggest logo file a Store package ships for an app. Packages list one logo
//! (`Assets\Square44x44Logo.png`) and ship variants beside it: `.targetsize-256.png`, `.scale-200.png`.

use std::path::{Path, PathBuf};

/// Variant suffixes between the file stem and `.png`, best first: a plate-free glyph at the largest target
/// size, then the largest scales. Plated variants come after, because the dock draws its own plate.
const VARIANTS: [&str; 14] = [
    ".targetsize-256_altform-unplated",
    ".targetsize-256",
    ".targetsize-96_altform-unplated",
    ".targetsize-96",
    ".targetsize-64_altform-unplated",
    ".targetsize-64",
    ".scale-400",
    ".scale-200",
    ".targetsize-48_altform-unplated",
    ".targetsize-48",
    ".scale-150",
    ".scale-125",
    ".scale-100",
    "",
];

/// `relative` is the path from the manifest (`Assets\Square44x44Logo.png`) and `root` the package folder.
/// Returns the best existing variant, or `None` when no file exists at all.
pub fn best_logo(root: &Path, relative: &str) -> Option<PathBuf> {
    let relative = relative.replace('\\', "/");
    let path = root.join(&relative);
    let stem = path.file_stem()?.to_string_lossy().into_owned();
    let extension = path.extension().map_or_else(|| "png".to_owned(), |e| e.to_string_lossy().into_owned());
    let folder = path.parent()?;
    VARIANTS
        .iter()
        .map(|variant| folder.join(format!("{stem}{variant}.{extension}")))
        .find(|candidate| candidate.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(root: &Path, names: &[&str]) {
        std::fs::create_dir_all(root.join("Assets")).unwrap();
        for name in names {
            std::fs::write(root.join("Assets").join(name), b"x").unwrap();
        }
    }

    #[test]
    fn prefers_the_unplated_256_variant() {
        let dir = tempfile::tempdir().unwrap();
        touch(
            dir.path(),
            &["Logo.png", "Logo.scale-200.png", "Logo.targetsize-256.png", "Logo.targetsize-256_altform-unplated.png"],
        );
        let best = best_logo(dir.path(), "Assets\\Logo.png").unwrap();
        assert_eq!(best.file_name().unwrap(), "Logo.targetsize-256_altform-unplated.png");
    }

    #[test]
    fn falls_back_to_scales_then_the_plain_file() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), &["Logo.png", "Logo.scale-100.png", "Logo.scale-200.png"]);
        assert_eq!(best_logo(dir.path(), "Assets\\Logo.png").unwrap().file_name().unwrap(), "Logo.scale-200.png");
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), &["Logo.png"]);
        assert_eq!(best_logo(dir.path(), "Assets\\Logo.png").unwrap().file_name().unwrap(), "Logo.png");
    }

    #[test]
    fn no_file_means_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(best_logo(dir.path(), "Assets\\Missing.png").is_none());
    }
}
