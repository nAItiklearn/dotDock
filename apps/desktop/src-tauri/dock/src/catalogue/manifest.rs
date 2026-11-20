//! Just enough of `AppxManifest.xml` to name a packaged app's publisher and find its logo files. A tag
//! scanner, not an XML parser: the manifest is machine-written and the few things read from it are attributes.

/// What the dock reads from one package manifest.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Manifest {
    /// Common name of the signing publisher (`Microsoft Corporation`).
    pub publisher: Option<String>,
    /// `PublisherDisplayName` when it is plain text (resource references are skipped).
    pub publisher_display: Option<String>,
    pub applications: Vec<ManifestApp>,
}

/// One `<Application>` with the logo paths of its visual elements, relative to the package root.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ManifestApp {
    pub id: String,
    pub square44: Option<String>,
    pub square150: Option<String>,
    /// The Windows 8 era `Logo` attribute, the only one older packages have.
    pub logo: Option<String>,
}

impl Manifest {
    /// The publisher to show: the plain display name if present, else the certificate's common name.
    pub fn publisher_name(&self) -> Option<String> {
        self.publisher_display.clone().or_else(|| self.publisher.clone())
    }

    pub fn application(&self, id: &str) -> Option<&ManifestApp> {
        self.applications.iter().find(|a| a.id.eq_ignore_ascii_case(id)).or_else(|| self.applications.first())
    }
}

struct Tag<'a> {
    /// Local name without the namespace prefix.
    name: &'a str,
    closing: bool,
    attributes: &'a str,
    /// Text between this tag's `>` and the next `<`.
    text: &'a str,
}

fn tags(xml: &str) -> Vec<Tag<'_>> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(open) = rest.find('<') {
        rest = &rest[open + 1..];
        if rest.starts_with("!--") {
            rest = rest.find("-->").map_or("", |end| &rest[end + 3..]);
            continue;
        }
        let Some(close) = rest.find('>') else { break };
        let inner = &rest[..close];
        let after = &rest[close + 1..];
        let text_end = after.find('<').unwrap_or(after.len());
        let closing = inner.starts_with('/');
        if !inner.starts_with('?') && !inner.starts_with('!') {
            let body = inner.trim_start_matches('/');
            let name_end = body.find(|c: char| c.is_whitespace() || c == '/').unwrap_or(body.len());
            let qualified = &body[..name_end];
            let local = qualified.rsplit(':').next().unwrap_or(qualified);
            out.push(Tag { name: local, closing, attributes: &body[name_end..], text: after[..text_end].trim() });
        }
        rest = after;
    }
    out
}

/// Value of attribute `key` in a tag's attribute text; the key is matched with or without a namespace prefix.
fn attribute(attributes: &str, key: &str) -> Option<String> {
    let mut rest = attributes;
    while let Some(eq) = rest.find('=') {
        let name = rest[..eq].trim().rsplit(|c: char| c.is_whitespace()).next().unwrap_or("");
        let value_part = rest[eq + 1..].trim_start();
        let quote = value_part.chars().next().filter(|c| *c == '"' || *c == '\'')?;
        let body = &value_part[1..];
        let end = body.find(quote)?;
        let local = name.rsplit(':').next().unwrap_or(name);
        if local.eq_ignore_ascii_case(key) {
            return Some(decode(&body[..end]));
        }
        rest = &body[end + 1..];
    }
    None
}

fn decode(raw: &str) -> String {
    raw.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'")
}

/// The first `CN=` value of a certificate subject; handles a quoted value (`CN="Foo, Inc."`).
pub fn common_name(subject: &str) -> Option<String> {
    let start = subject.find("CN=")? + 3;
    let rest = &subject[start..];
    let value =
        if let Some(quoted) = rest.strip_prefix('"') { quoted.split('"').next()? } else { rest.split(',').next()? };
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_owned())
}

fn plain(value: &str) -> Option<String> {
    let v = value.trim();
    (!v.is_empty() && !v.starts_with("ms-resource:")).then(|| v.to_owned())
}

pub fn parse(xml: &str) -> Manifest {
    let mut manifest = Manifest::default();
    let mut current: Option<ManifestApp> = None;
    for tag in tags(xml) {
        match (tag.name, tag.closing) {
            ("Identity", false) => {
                manifest.publisher = attribute(tag.attributes, "Publisher").as_deref().and_then(common_name);
            }
            ("PublisherDisplayName", false) => manifest.publisher_display = plain(tag.text),
            ("Application", false) => {
                current = attribute(tag.attributes, "Id").map(|id| ManifestApp { id, ..ManifestApp::default() });
            }
            ("Application", true) => manifest.applications.extend(current.take()),
            ("VisualElements", false) => {
                if let Some(app) = current.as_mut() {
                    app.square44 = attribute(tag.attributes, "Square44x44Logo");
                    app.square150 = attribute(tag.attributes, "Square150x150Logo");
                    app.logo = attribute(tag.attributes, "Logo");
                }
            }
            _ => {}
        }
    }
    manifest.applications.extend(current.take());
    manifest
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r##"<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
         xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10">
  <Identity Name="Microsoft.WindowsCalculator" Publisher="CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US" Version="11.2.0.0" />
  <Properties>
    <DisplayName>ms-resource:AppStoreName</DisplayName>
    <PublisherDisplayName>Microsoft Corporation</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <!-- <Application Id="Ghost"> -->
  <Applications>
    <Application Id="App" Executable="CalculatorApp.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="ms-resource:AppStoreName" Square150x150Logo="Assets\CalculatorMedTile.png"
        Square44x44Logo="Assets\CalculatorAppList.png" BackgroundColor="#0078D7">
        <uap:DefaultTile Wide310x150Logo="Assets\CalculatorWideTile.png" />
      </uap:VisualElements>
    </Application>
  </Applications>
</Package>"##;

    #[test]
    fn reads_publisher_and_logos() {
        let m = parse(SAMPLE);
        assert_eq!(m.publisher.as_deref(), Some("Microsoft Corporation"));
        assert_eq!(m.publisher_display.as_deref(), Some("Microsoft Corporation"));
        assert_eq!(m.applications.len(), 1);
        let app = m.application("App").unwrap();
        assert_eq!(app.square44.as_deref(), Some("Assets\\CalculatorAppList.png"));
        assert_eq!(app.square150.as_deref(), Some("Assets\\CalculatorMedTile.png"));
    }

    #[test]
    fn resource_publisher_names_fall_back_to_the_certificate() {
        let xml = r#"<Package><Identity Publisher="CN=Foo Ltd" /><Properties><PublisherDisplayName>ms-resource:Pub</PublisherDisplayName></Properties></Package>"#;
        let m = parse(xml);
        assert_eq!(m.publisher_name().as_deref(), Some("Foo Ltd"));
    }

    #[test]
    fn quoted_common_names() {
        assert_eq!(common_name("CN=\"Foo, Inc.\", O=Foo").as_deref(), Some("Foo, Inc."));
        assert_eq!(common_name("O=Foo"), None);
    }

    #[test]
    fn unknown_application_id_falls_back_to_the_first() {
        let m = parse(SAMPLE);
        assert_eq!(m.application("Other").unwrap().id, "App");
    }

    #[test]
    fn win8_logo_attribute_and_entities() {
        let xml = r#"<Package><Applications><Application Id="X"><m2:VisualElements Logo="a&amp;b.png"/></Application></Applications></Package>"#;
        let m = parse(xml);
        assert_eq!(m.applications[0].logo.as_deref(), Some("a&b.png"));
    }
}
