//! Files each app into a category with no network and no AI service. In order:
//!
//! 1. the user's own assignment (`FiledBy::User`);
//! 2. the bundled, reviewed table of well-known apps (`known`, `FiledBy::Known`);
//! 3. for packaged apps, rules on the package identity (`FiledBy::Store`);
//! 4. rules on the Start menu folder, the publisher and keywords in the name (`rules`, `FiledBy::Rule`);
//! 5. "Other" (`FiledBy::Fallback`).

pub mod known;
pub mod rules;

use crate::catalogue::AppEntry;
use crate::protocol::{Builtin, CategoryId, FiledBy};
use crate::util::normalise_name;
use known::TABLE;

/// What the classifier looks at, already in the forms it matches.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Subject {
    /// Normalised name (`visual studio code`).
    pub name: String,
    /// Normalised publisher, empty when unknown.
    pub publisher: String,
    /// Normalised first Start menu folder, empty when the app has none.
    pub folder: String,
    /// Lower-case AppUserModelID, empty when the app has none.
    pub aumid: String,
    /// Lower-case file name of the program (`code.exe`), empty when unknown.
    pub exe: String,
    /// Lower-case target, used to spot protocol launchers such as `steam://`.
    pub target: String,
    pub packaged: bool,
}

impl Subject {
    pub fn from_entry(entry: &AppEntry) -> Subject {
        Subject {
            name: normalise_name(&entry.name),
            publisher: entry.publisher.as_deref().map(normalise_name).unwrap_or_default(),
            folder: entry.folder.as_deref().map(normalise_name).unwrap_or_default(),
            aumid: entry.aumid.as_deref().unwrap_or_default().to_lowercase(),
            exe: entry.exe_name().unwrap_or_default(),
            target: entry.target.as_deref().unwrap_or_default().to_lowercase(),
            packaged: entry.packaged(),
        }
    }

    /// For tests and tools that have only strings.
    pub fn of(name: &str, publisher: &str, folder: &str, aumid: &str, exe: &str) -> Subject {
        Subject {
            name: normalise_name(name),
            publisher: normalise_name(publisher),
            folder: normalise_name(folder),
            aumid: aumid.to_lowercase(),
            exe: exe.to_lowercase(),
            ..Subject::default()
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Classification {
    pub category: CategoryId,
    pub filed_by: FiledBy,
}

fn filed(category: Builtin, filed_by: FiledBy) -> Classification {
    Classification { category: category.into(), filed_by }
}

/// Protocol launchers whose target says which kind of app they start.
const GAME_PROTOCOLS: [&str; 3] = ["steam://", "com.epicgames.launcher://", "uplay://"];

/// `name:` pattern against a normalised name: exact, or `stem*` for the stem followed by more whole words.
fn name_matches(name: &str, pattern: &str) -> bool {
    match pattern.strip_suffix('*') {
        Some(stem) => name == stem || name.strip_prefix(stem).is_some_and(|rest| rest.starts_with(' ')),
        None => name == pattern,
    }
}

fn known_matches(subject: &Subject, pattern: &str) -> bool {
    if let Some(p) = pattern.strip_prefix("name:") {
        !subject.name.is_empty() && name_matches(&subject.name, p)
    } else if let Some(p) = pattern.strip_prefix("exe:") {
        !subject.exe.is_empty() && subject.exe == p
    } else if let Some(p) = pattern.strip_prefix("aumid:") {
        !subject.aumid.is_empty() && subject.aumid.starts_with(p)
    } else {
        false
    }
}

fn from_table(subject: &Subject) -> Option<Builtin> {
    TABLE.iter().find(|g| g.patterns.iter().any(|p| known_matches(subject, p))).map(|g| g.category)
}

/// Phrase against normalised text, on word boundaries. A trailing `*` lets the last word be a prefix, and a
/// plain phrase must be whole words.
fn phrase_in(text: &str, phrase: &str) -> bool {
    if text.is_empty() {
        return false;
    }
    let padded = format!(" {text} ");
    match phrase.strip_suffix('*') {
        Some(stem) => padded.contains(&format!(" {stem}")),
        None => padded.contains(&format!(" {phrase} ")),
    }
}

/// A Start menu folder is named for its vendor or product, so the rule has to match the folder name from its
/// first word (`adobe*` matches `adobe photoshop`, not `not adobe`).
fn folder_hit(folder: &str) -> Option<Builtin> {
    if folder.is_empty() {
        return None;
    }
    rules::FOLDER.iter().find(|r| r.phrases.iter().any(|p| name_matches(folder, p))).map(|r| r.category)
}

fn name_hit(name: &str) -> Option<Builtin> {
    rules::NAME.iter().find(|r| r.phrases.iter().any(|p| phrase_in(name, p))).map(|r| r.category)
}

fn publisher_hit(publisher: &str) -> Option<Builtin> {
    if publisher.is_empty() {
        return None;
    }
    // Publisher names run words together (`ankergames`), so the phrase is looked for anywhere in the text.
    rules::PUBLISHER.iter().find(|r| r.phrases.iter().any(|p| publisher.contains(p))).map(|r| r.category)
}

fn store_hit(subject: &Subject) -> Option<Builtin> {
    if !subject.packaged {
        return None;
    }
    rules::STORE.iter().find(|(prefix, _)| subject.aumid.starts_with(prefix)).map(|(_, c)| *c)
}

fn rule_based(subject: &Subject) -> Option<Builtin> {
    if GAME_PROTOCOLS.iter().any(|p| subject.target.starts_with(p)) {
        return Some(Builtin::Games);
    }
    folder_hit(&subject.folder).or_else(|| publisher_hit(&subject.publisher)).or_else(|| name_hit(&subject.name))
}

/// Files one app. `user` is the user's own assignment for this app, when there is one.
pub fn classify(subject: &Subject, user: Option<&CategoryId>) -> Classification {
    if let Some(category) = user {
        return Classification { category: category.clone(), filed_by: FiledBy::User };
    }
    if let Some(category) = from_table(subject) {
        return filed(category, FiledBy::Known);
    }
    if let Some(category) = store_hit(subject) {
        return filed(category, FiledBy::Store);
    }
    if let Some(category) = rule_based(subject) {
        return filed(category, FiledBy::Rule);
    }
    filed(Builtin::Other, FiledBy::Fallback)
}

#[cfg(test)]
mod tests;
