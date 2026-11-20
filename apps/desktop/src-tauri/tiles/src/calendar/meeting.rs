//! Finding the "join" link of an online meeting in an event's location, details or link fields.

use crate::protocol::{MeetingLink, MeetingService};

/// Links longer than this are not meeting links.
const MAX_URL_CHARS: usize = 2048;
/// Only this much of a long description is searched.
const MAX_TEXT_CHARS: usize = 20_000;
/// Characters that end a link inside running text.
const URL_END: &[char] = &['<', '>', '"', '\'', ' ', '\t', '\r', '\n', ')', ']', '}', '\\', '|'];
/// Punctuation a sentence puts right after a link.
const TRAILING: &[char] = &['.', ',', ';', ':', '!', '?'];

fn host_and_path(url: &str) -> Option<(String, String)> {
    let rest = url.strip_prefix("https://")?;
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let host = rest[..end].split('@').next_back()?.split(':').next()?.to_ascii_lowercase();
    Some((host, rest[end..].to_ascii_lowercase()))
}

fn host_is(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{domain}"))
}

fn classify(url: &str) -> Option<MeetingService> {
    let lower = url.to_ascii_lowercase();
    if lower.starts_with("msteams:") {
        return Some(MeetingService::Teams);
    }
    if lower.starts_with("zoommtg:") || lower.starts_with("zoomus:") {
        return Some(MeetingService::Zoom);
    }
    let (host, path) = host_and_path(url)?;
    if (host_is(&host, "teams.microsoft.com") && (path.starts_with("/l/meetup-join") || path.starts_with("/meet/")))
        || (host_is(&host, "teams.live.com") && path.starts_with("/meet/"))
        || (host_is(&host, "teams.microsoft.us") && path.starts_with("/l/meetup-join"))
    {
        return Some(MeetingService::Teams);
    }
    if (host_is(&host, "zoom.us") || host_is(&host, "zoom.com") || host_is(&host, "zoomgov.com"))
        && ["/j/", "/my/", "/w/", "/wc/join", "/s/"].iter().any(|p| path.starts_with(p))
    {
        return Some(MeetingService::Zoom);
    }
    if host == "meet.google.com" && path.len() > 4 {
        return Some(MeetingService::Meet);
    }
    if host_is(&host, "webex.com")
        && ["/meet/", "/join/", "/j.php", "/webappng"].iter().any(|p| path.starts_with(p) || path.contains(p))
    {
        return Some(MeetingService::Webex);
    }
    let others = ["whereby.com", "meet.jit.si", "gotomeet.me", "gotomeeting.com", "bluejeans.com", "chime.aws"];
    others.iter().any(|d| host_is(&host, d) && path.len() > 1).then_some(MeetingService::Other)
}

/// Every link-looking token in `text`, in order.
fn candidates(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = text;
    loop {
        // ASCII lower-casing keeps byte offsets, so positions found here index `rest` too.
        let lower = rest.to_ascii_lowercase();
        let Some(at) = ["https://", "msteams:", "zoommtg:", "zoomus:"].iter().filter_map(|s| lower.find(s)).min()
        else {
            break;
        };
        let tail = &rest[at..];
        let len = tail.find(URL_END).unwrap_or(tail.len());
        let token = tail[..len].trim_end_matches(TRAILING);
        if !token.is_empty() && token.len() <= MAX_URL_CHARS {
            out.push(token);
        }
        rest = &tail[len.max(1)..];
    }
    out
}

/// The first meeting link found in the given texts, searched in order (put the most specific field first).
pub fn find_join_link<'a>(texts: impl IntoIterator<Item = &'a str>) -> Option<MeetingLink> {
    for text in texts {
        let text: String = text.chars().take(MAX_TEXT_CHARS).collect();
        // Mail clients wrap links in angle brackets or "<https://...>"; candidates() stops at those.
        for token in candidates(&text) {
            if let Some(service) = classify(token) {
                return Some(MeetingLink { service, url: token.to_owned() });
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn found(text: &str) -> Option<(MeetingService, String)> {
        find_join_link([text]).map(|l| (l.service, l.url))
    }

    #[test]
    fn teams_links_are_found_inside_an_invitation() {
        let body = "Join the meeting now<https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%7d>\nMeeting ID: 1";
        let (service, url) = found(body).unwrap();
        assert_eq!(service, MeetingService::Teams);
        assert!(url.starts_with("https://teams.microsoft.com/l/meetup-join/") && url.ends_with("%7d"));
    }

    #[test]
    fn zoom_meet_and_webex_are_recognised() {
        assert_eq!(found("see https://us02web.zoom.us/j/81234567890?pwd=abc.").unwrap().0, MeetingService::Zoom);
        assert_eq!(found("https://meet.google.com/abc-defg-hij").unwrap().0, MeetingService::Meet);
        assert_eq!(found("https://acme.webex.com/meet/jdoe").unwrap().0, MeetingService::Webex);
        assert_eq!(found("zoommtg://zoom.us/join?confno=123456789").unwrap().0, MeetingService::Zoom);
        assert_eq!(found("https://teams.live.com/meet/9300000000001").unwrap().0, MeetingService::Teams);
    }

    #[test]
    fn a_sentence_does_not_swallow_the_link_or_its_full_stop() {
        let (_, url) = found("Join at https://zoom.us/j/123456789.").unwrap();
        assert_eq!(url, "https://zoom.us/j/123456789");
    }

    #[test]
    fn ordinary_links_and_lookalikes_are_ignored() {
        assert_eq!(found("Agenda: https://docs.example.com/plan"), None);
        assert_eq!(found("https://evil.example/teams.microsoft.com/l/meetup-join/x"), None);
        assert_eq!(found("https://zoom.us.evil.example/j/123456789"), None);
        assert_eq!(found("http://meet.google.com/abc-defg-hij"), None, "plain http is not offered");
        assert_eq!(found("Room 4, second floor"), None);
    }

    #[test]
    fn the_first_field_with_a_link_wins() {
        let link =
            find_join_link(["Room 4", "https://meet.google.com/aaa-bbbb-ccc and https://zoom.us/j/123456789"]).unwrap();
        assert_eq!(link.service, MeetingService::Meet);
    }

    #[test]
    fn a_link_in_the_middle_of_other_links_is_picked() {
        let link = find_join_link(["https://example.com/a https://zoom.us/j/123456789 https://example.com/b"]).unwrap();
        assert_eq!(link.service, MeetingService::Zoom);
    }
}
