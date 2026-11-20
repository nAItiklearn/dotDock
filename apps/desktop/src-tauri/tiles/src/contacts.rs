//! Quick contacts: a few people the user picks, each with the ways to reach them, opened through the apps the user
//! already has (Phone Link for `tel:`, Teams, Zoom, WhatsApp, Discord, the mail app). The list is typed in by the
//! user and saved in `contacts.json`; nothing is read from an address book and nothing leaves the machine.

use crate::clock::now_ms;
use crate::emit::{lock, Emitter};
use crate::paths;
use crate::protocol::{Channel, Contact, ContactAction, ContactsState, Handle, TileData};
use std::path::PathBuf;
use std::sync::Mutex;

pub const MAX_CONTACTS: usize = 12;
const MAX_HANDLES: usize = 8;
const MAX_NAME_CHARS: usize = 60;
/// Digits in an international phone number (E.164 allows up to 15).
const PHONE_DIGITS: std::ops::RangeInclusive<usize> = 5..=15;
/// Digits in a Zoom meeting id.
const ZOOM_DIGITS: std::ops::RangeInclusive<usize> = 6..=14;
/// Digits in a Discord user id (a snowflake).
const DISCORD_DIGITS: std::ops::RangeInclusive<usize> = 15..=21;
const MAX_EMAIL_CHARS: usize = 254;

/// Keeps digits, and a leading `+` for phone numbers.
fn phone_digits(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    let plus = trimmed.starts_with('+');
    let digits: String = trimmed.chars().filter(char::is_ascii_digit).collect();
    let allowed_noise = trimmed.chars().all(|c| c.is_ascii_digit() || " -().+".contains(c));
    if !allowed_noise || !PHONE_DIGITS.contains(&digits.len()) {
        return Err("Enter a phone number with country code, such as +15551234567".to_owned());
    }
    Ok(if plus { format!("+{digits}") } else { digits })
}

fn plain_digits(value: &str, range: &std::ops::RangeInclusive<usize>, what: &str) -> Result<String, String> {
    let digits: String = value.chars().filter(|c| !c.is_whitespace() && *c != '-').collect();
    if digits.chars().all(|c| c.is_ascii_digit()) && range.contains(&digits.len()) {
        Ok(digits)
    } else {
        Err(format!("That does not look like a {what}"))
    }
}

fn email(value: &str) -> Result<String, String> {
    let v = value.trim();
    let ok = v.len() <= MAX_EMAIL_CHARS
        && v.matches('@').count() == 1
        && !v.starts_with('@')
        && !v.ends_with('@')
        && v.split('@').nth(1).is_some_and(|d| d.contains('.') && !d.starts_with('.') && !d.ends_with('.'))
        && v.chars().all(|c| c.is_ascii_alphanumeric() || "@.+-_'".contains(c));
    if ok {
        Ok(v.to_owned())
    } else {
        Err("That does not look like an email address".to_owned())
    }
}

/// Percent-encodes everything but unreserved characters, so a value can sit inside a link without altering it.
fn encode(value: &str) -> String {
    value.bytes().fold(String::new(), |mut out, b| {
        if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
        out
    })
}

/// Checks and tidies a handle's value for its channel.
pub fn normalise(channel: Channel, value: &str) -> Result<String, String> {
    match channel {
        Channel::Phone | Channel::Whatsapp => phone_digits(value),
        Channel::Zoom => plain_digits(value, &ZOOM_DIGITS, "Zoom meeting id"),
        Channel::Discord => plain_digits(value, &DISCORD_DIGITS, "Discord user id"),
        Channel::Email | Channel::Teams => email(value),
    }
}

/// The link that performs `action` on `channel` for the (already normalised) `value`, or why it cannot.
pub fn link(channel: Channel, action: ContactAction, value: &str) -> Result<String, String> {
    use Channel::*;
    use ContactAction::*;
    let unsupported = |what: &str| Err(format!("{what} is not available this way"));
    match (channel, action) {
        (Phone, Call) => Ok(format!("tel:{value}")),
        (Phone, Message) => Ok(format!("sms:{value}")),
        (Phone, Video) => unsupported("A video call over a phone number"),
        (Teams, Message) => Ok(format!("msteams://teams.microsoft.com/l/chat/0/0?users={}", encode(value))),
        (Teams, Call) => Ok(format!("msteams://teams.microsoft.com/l/call/0/0?users={}", encode(value))),
        (Teams, Video) => {
            Ok(format!("msteams://teams.microsoft.com/l/call/0/0?users={}&withVideo=true", encode(value)))
        }
        (Zoom, Call | Video) => Ok(format!("zoommtg://zoom.us/join?confno={value}")),
        (Zoom, Message) => unsupported("Messaging in Zoom"),
        // WhatsApp has no public call link; its chat opens and the call button is one tap away.
        (Whatsapp, Message | Call) => Ok(format!("whatsapp://send?phone={}", value.trim_start_matches('+'))),
        (Whatsapp, Video) => unsupported("A WhatsApp video call"),
        (Discord, Message) => Ok(format!("discord://-/users/{value}")),
        (Discord, Call | Video) => unsupported("Calling on Discord"),
        (Email, Message) => Ok(format!("mailto:{value}")),
        (Email, Call | Video) => unsupported("Calling an email address"),
    }
}

/// Whether `action` can be performed over `channel` at all. The failures of [`link`] do not depend on the value.
pub fn supports(channel: Channel, action: ContactAction) -> bool {
    link(channel, action, "").is_ok()
}

fn clean(mut contact: Contact) -> Result<Contact, String> {
    contact.name = contact.name.trim().to_owned();
    if contact.name.is_empty() || contact.name.chars().count() > MAX_NAME_CHARS {
        return Err("A contact needs a name of up to 60 characters".to_owned());
    }
    if contact.handles.is_empty() || contact.handles.len() > MAX_HANDLES {
        return Err("A contact needs between one and eight ways to reach them".to_owned());
    }
    let mut handles: Vec<Handle> = Vec::new();
    for h in &contact.handles {
        let value = normalise(h.channel, &h.value)?;
        if !handles.iter().any(|x| x.channel == h.channel && x.value == value) {
            handles.push(Handle { channel: h.channel, value });
        }
    }
    contact.handles = handles;
    if contact.id.trim().is_empty() {
        contact.id = format!("{:x}", now_ms());
    }
    Ok(contact)
}

pub struct Contacts {
    file: PathBuf,
    emitter: Emitter,
    list: Mutex<Vec<Contact>>,
}

impl Contacts {
    pub fn new(file: PathBuf, emitter: Emitter) -> Self {
        let list = paths::read_json::<Vec<Contact>>(&file).unwrap_or_default();
        Self { file, emitter, list: Mutex::new(list) }
    }

    pub fn state(&self) -> ContactsState {
        ContactsState { contacts: lock(&self.list).clone() }
    }

    fn commit(&self, mut list: std::sync::MutexGuard<'_, Vec<Contact>>, next: Vec<Contact>) -> Result<(), String> {
        paths::write_json(&self.file, &next)?;
        *list = next;
        let state = ContactsState { contacts: list.clone() };
        drop(list);
        self.emitter.emit(TileData::Contacts(state));
        Ok(())
    }

    /// Adds a contact, or replaces the one with the same id.
    pub fn save(&self, contact: Contact) -> Result<(), String> {
        let contact = clean(contact)?;
        let list = lock(&self.list);
        let mut next = list.clone();
        match next.iter().position(|c| c.id == contact.id) {
            Some(i) => next[i] = contact,
            None if next.len() >= MAX_CONTACTS => return Err(format!("The tile holds up to {MAX_CONTACTS} contacts")),
            None => next.push(contact),
        }
        self.commit(list, next)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let list = lock(&self.list);
        let next: Vec<Contact> = list.iter().filter(|c| c.id != id).cloned().collect();
        if next.len() == list.len() {
            return Ok(());
        }
        self.commit(list, next)
    }

    /// The link that performs `action` for a stored contact, over the first of their ways that can. The caller opens it.
    pub fn link_for_action(&self, id: &str, action: ContactAction) -> Result<String, String> {
        let list = lock(&self.list);
        let contact = list.iter().find(|c| c.id == id).ok_or("That contact is gone")?;
        contact
            .handles
            .iter()
            .find_map(|h| link(h.channel, action, &h.value).ok())
            .ok_or_else(|| format!("{} has no way to do that", contact.name))
    }

    /// The link for a stored contact's channel and action. The caller opens it.
    pub fn link_for(&self, id: &str, channel: Channel, action: ContactAction) -> Result<String, String> {
        let list = lock(&self.list);
        let contact = list.iter().find(|c| c.id == id).ok_or("That contact is gone")?;
        let handle = contact
            .handles
            .iter()
            .find(|h| h.channel == channel)
            .ok_or_else(|| format!("{} has no entry for that app", contact.name))?;
        link(channel, action, &handle.value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;

    fn contact(name: &str, handles: &[(Channel, &str)]) -> Contact {
        Contact {
            id: String::new(),
            name: name.to_owned(),
            handles: handles.iter().map(|(c, v)| Handle { channel: *c, value: (*v).to_owned() }).collect(),
        }
    }

    #[test]
    fn phone_numbers_are_tidied() {
        assert_eq!(normalise(Channel::Phone, "+1 (555) 123-4567").unwrap(), "+15551234567");
        assert_eq!(normalise(Channel::Phone, "020 7946 0958").unwrap(), "02079460958");
        assert!(normalise(Channel::Phone, "call me").is_err());
        assert!(normalise(Channel::Phone, "123").is_err());
        assert!(normalise(Channel::Phone, "+1555123456789012345").is_err());
    }

    #[test]
    fn emails_are_checked() {
        assert_eq!(normalise(Channel::Teams, " ada@example.com ").unwrap(), "ada@example.com");
        for bad in ["ada", "ada@", "@example.com", "a b@example.com", "a@b@c.com", "ada@example", "a@example.com&x=1"] {
            assert!(normalise(Channel::Email, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn links_use_each_apps_scheme() {
        assert_eq!(link(Channel::Phone, ContactAction::Call, "+15551234567").unwrap(), "tel:+15551234567");
        assert_eq!(link(Channel::Phone, ContactAction::Message, "+15551234567").unwrap(), "sms:+15551234567");
        assert_eq!(
            link(Channel::Teams, ContactAction::Video, "ada@example.com").unwrap(),
            "msteams://teams.microsoft.com/l/call/0/0?users=ada%40example.com&withVideo=true"
        );
        assert_eq!(
            link(Channel::Zoom, ContactAction::Video, "1234567890").unwrap(),
            "zoommtg://zoom.us/join?confno=1234567890"
        );
        assert_eq!(
            link(Channel::Whatsapp, ContactAction::Message, "+15551234567").unwrap(),
            "whatsapp://send?phone=15551234567"
        );
        assert_eq!(
            link(Channel::Discord, ContactAction::Message, "123456789012345678").unwrap(),
            "discord://-/users/123456789012345678"
        );
        assert_eq!(link(Channel::Email, ContactAction::Message, "ada@example.com").unwrap(), "mailto:ada@example.com");
    }

    #[test]
    fn unsupported_actions_say_so() {
        assert!(link(Channel::Discord, ContactAction::Call, "123456789012345678").is_err());
        assert!(link(Channel::Zoom, ContactAction::Message, "1234567890").is_err());
        assert!(link(Channel::Email, ContactAction::Video, "a@b.co").is_err());
    }

    #[test]
    fn every_link_passes_the_launch_allow_list() {
        let cases = [
            (Channel::Phone, "+15551234567"),
            (Channel::Teams, "ada@example.com"),
            (Channel::Zoom, "1234567890"),
            (Channel::Whatsapp, "+15551234567"),
            (Channel::Discord, "123456789012345678"),
            (Channel::Email, "ada@example.com"),
        ];
        for (channel, value) in cases {
            for action in [ContactAction::Call, ContactAction::Video, ContactAction::Message] {
                if let Ok(uri) = link(channel, action, value) {
                    assert!(crate::shell::is_allowed_uri(&uri), "{uri}");
                }
            }
        }
    }

    #[test]
    fn contacts_save_edit_remove_and_survive_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("contacts.json");
        let (tx, rx) = channel();
        let emitter = Emitter::new(move |d| {
            let _ = tx.send(d);
        });
        let book = Contacts::new(file.clone(), emitter.clone());
        book.save(contact("Ada", &[(Channel::Phone, "+1 555 123 4567"), (Channel::Phone, "+15551234567")])).unwrap();
        let saved = book.state().contacts;
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].handles.len(), 1, "duplicates collapse");
        assert!(!saved[0].id.is_empty());
        let mut edited = saved[0].clone();
        edited.name = "Ada L.".into();
        book.save(edited).unwrap();
        assert_eq!(book.state().contacts.len(), 1);
        assert!(matches!(rx.try_iter().last(), Some(TileData::Contacts(_))));
        assert_eq!(Contacts::new(file, emitter).state().contacts[0].name, "Ada L.");
        let id = book.state().contacts[0].id.clone();
        assert!(book.link_for(&id, Channel::Phone, ContactAction::Call).is_ok());
        assert!(book.link_for(&id, Channel::Teams, ContactAction::Call).is_err());
        book.remove(&id).unwrap();
        assert!(book.state().contacts.is_empty());
    }

    #[test]
    fn bad_contacts_are_rejected_with_a_reason() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, _rx) = channel();
        let book = Contacts::new(dir.path().join("c.json"), Emitter::new(move |d| drop(tx.send(d))));
        assert!(book.save(contact("", &[(Channel::Phone, "+15551234567")])).is_err());
        assert!(book.save(contact("Ada", &[])).is_err());
        assert!(book.save(contact("Ada", &[(Channel::Phone, "nope")])).is_err());
        for i in 0..MAX_CONTACTS {
            book.save(contact(&format!("P{i}"), &[(Channel::Phone, "+15551234567")])).unwrap();
        }
        assert!(book.save(contact("One too many", &[(Channel::Phone, "+15551234567")])).is_err());
    }
}
