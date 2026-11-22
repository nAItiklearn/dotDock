//! The dock's first layout, made once from the apps this user really has (D-027).
//!
//! A new dock with nothing pinned shows only the running apps, which reads as broken. So after the first scan the
//! dock pins a few everyday apps the user has installed, one stack per category that holds enough apps to be worth
//! a stack, and the live tiles that need no account. It runs once: a user who later removes everything gets the
//! empty dock they asked for.

use crate::protocol::{Builtin, CategoryId, DockApp, PinnedItem};

/// Everyday apps, in the order they sit on the bar. Each slot takes the first of its names that is installed.
const PINNED_SLOTS: &[&[&str]] = &[
    &["File Explorer"],
    &["Google Chrome", "Microsoft Edge", "Firefox", "Brave"],
    &["Terminal", "Windows Terminal"],
    &["Visual Studio Code", "Cursor"],
    &["Spotify", "Media Player"],
    &["Settings"],
];

/// Categories that may become a stack, in the order the stacks sit on the bar.
const STACK_CATEGORIES: [Builtin; 7] = [
    Builtin::Productivity,
    Builtin::Development,
    Builtin::Creative,
    Builtin::Communication,
    Builtin::Media,
    Builtin::Games,
    Builtin::Utilities,
];

/// Fewest apps a category needs before it is worth a stack.
const MIN_STACK_APPS: usize = 3;
/// Most stacks the first layout makes, so the bar stays short.
const MAX_STACKS: usize = 4;

/// Live tiles that show real data with no account or setup: the clock, the system meters, what is playing, the apps
/// opened lately and the quick toggles (the owner's own dock, 2026-11-22).
pub const STARTER_TILES: [&str; 5] = ["clock", "system", "media", "history", "toggles"];

/// The first layout for `apps`: pinned apps and stacks, then the tiles.
pub fn starter_layout(apps: &[DockApp]) -> (Vec<PinnedItem>, Vec<String>) {
    let mut pinned: Vec<PinnedItem> = Vec::new();
    for slot in PINNED_SLOTS {
        let found = slot.iter().find_map(|name| apps.iter().find(|a| a.name.eq_ignore_ascii_case(name)));
        if let Some(app) = found {
            let item = PinnedItem::App { id: app.id.clone() };
            if !pinned.contains(&item) {
                pinned.push(item);
            }
        }
    }
    let stacks = STACK_CATEGORIES
        .into_iter()
        .map(CategoryId::from)
        .filter(|category| apps.iter().filter(|a| &a.category == category).count() >= MIN_STACK_APPS)
        .take(MAX_STACKS)
        .map(|category| PinnedItem::Stack { category });
    pinned.extend(stacks);
    (pinned, STARTER_TILES.iter().map(|t| (*t).to_owned()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::FiledBy;

    fn app(id: &str, name: &str, category: Builtin) -> DockApp {
        DockApp {
            id: id.into(),
            name: name.into(),
            category: category.into(),
            filed_by: FiledBy::Known,
            icon: String::new(),
            publisher: None,
            first_seen: 0,
        }
    }

    #[test]
    fn pins_the_installed_everyday_apps_in_order_and_one_browser() {
        let apps = vec![
            app("edge", "Microsoft Edge", Builtin::Browsers),
            app("settings", "Settings", Builtin::System),
            app("files", "File Explorer", Builtin::System),
            app("brave", "Brave", Builtin::Browsers),
            app("term", "Terminal", Builtin::Development),
        ];
        let (pinned, tiles) = starter_layout(&apps);
        let ids: Vec<&str> = pinned
            .iter()
            .filter_map(|p| match p {
                PinnedItem::App { id } => Some(id.as_str()),
                PinnedItem::Stack { .. } => None,
            })
            .collect();
        assert_eq!(ids, ["files", "edge", "term", "settings"]);
        assert_eq!(tiles, ["clock", "system", "media", "history", "toggles"]);
    }

    #[test]
    fn makes_stacks_only_for_categories_with_enough_apps() {
        let mut apps: Vec<DockApp> =
            (0..5).map(|i| app(&format!("g{i}"), &format!("Game {i}"), Builtin::Games)).collect();
        apps.push(app("w", "Word", Builtin::Productivity));
        apps.push(app("x", "Excel", Builtin::Productivity));
        let (pinned, _) = starter_layout(&apps);
        assert_eq!(pinned, vec![PinnedItem::Stack { category: Builtin::Games.into() }]);
    }

    #[test]
    fn never_makes_more_than_the_most_stacks() {
        let apps: Vec<DockApp> = STACK_CATEGORIES
            .iter()
            .flat_map(|&c| {
                (0..MIN_STACK_APPS).map(move |i| app(&format!("{}{i}", c.as_str()), &format!("{} {i}", c.as_str()), c))
            })
            .collect();
        let (pinned, _) = starter_layout(&apps);
        assert_eq!(pinned.len(), MAX_STACKS);
        assert_eq!(pinned[0], PinnedItem::Stack { category: Builtin::Productivity.into() });
    }

    #[test]
    fn an_empty_catalogue_gives_only_the_tiles() {
        let (pinned, tiles) = starter_layout(&[]);
        assert!(pinned.is_empty());
        assert_eq!(tiles.len(), STARTER_TILES.len());
    }
}
