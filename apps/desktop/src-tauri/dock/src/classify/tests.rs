use super::*;

/// Name, publisher, Start menu folder, AppUserModelID, exe file name.
type Case = (&'static str, &'static str, &'static str, &'static str, &'static str);

fn run(case: Case) -> Classification {
    classify(&Subject::of(case.0, case.1, case.2, case.3, case.4), None)
}

fn assert_all(category: Builtin, filed_by: FiledBy, cases: &[Case]) {
    let wrong: Vec<String> = cases
        .iter()
        .filter_map(|&c| {
            let got = run(c);
            (got.category.as_str() != category.as_str() || got.filed_by != filed_by)
                .then(|| format!("{} filed as {} by {:?}", c.0, got.category, got.filed_by))
        })
        .collect();
    assert!(wrong.is_empty(), "expected {} by {:?}: {wrong:#?}", category.as_str(), filed_by);
}

#[test]
fn user_assignment_beats_everything() {
    let mine = CategoryId::parse("custom:work").unwrap();
    let c = classify(&Subject::of("Google Chrome", "Google LLC", "", "Chrome", "chrome.exe"), Some(&mine));
    assert_eq!(c.category, mine);
    assert_eq!(c.filed_by, FiledBy::User);
}

#[test]
fn unknown_apps_fall_back_to_other() {
    let c = run(("Zorblax Frobnicator", "", "", "", ""));
    assert_eq!((c.category.as_str(), c.filed_by), ("other", FiledBy::Fallback));
    let c = run(("", "", "", "", ""));
    assert_eq!(c.category.as_str(), "other");
}

#[test]
fn the_table_wins_over_rules() {
    // Acrobat is published by Adobe (a creative vendor) but is a PDF reader.
    let c = run(("Adobe Acrobat DC", "Adobe Systems Incorporated", "Adobe", "", "acrobat.exe"));
    assert_eq!((c.category.as_str(), c.filed_by), ("productivity", FiledBy::Known));
    // GitHub Copilot is AI although GitHub is a development publisher.
    let c = run(("GitHub Copilot", "GitHub Inc.", "", "com.github.githubapp", "github.exe"));
    assert_eq!(c.category.as_str(), "ai");
}

#[test]
fn known_apps_by_name() {
    use Builtin::*;
    let by_name = |names: &[&'static str]| -> Vec<Case> { names.iter().map(|n| (*n, "", "", "", "")).collect() };
    assert_all(
        Browsers,
        FiledBy::Known,
        &by_name(&[
            "Google Chrome",
            "Microsoft Edge",
            "Microsoft Edge Beta",
            "Firefox",
            "Mozilla Firefox",
            "Brave",
            "Opera GX",
            "Opera",
            "Arc",
            "Zen Browser",
            "Vivaldi",
            "Tor Browser",
            "DuckDuckGo",
            "Chromium",
            "Comet",
        ]),
    );
    assert_all(
        Development,
        FiledBy::Known,
        &by_name(&[
            "Visual Studio Code",
            "Visual Studio 2022",
            "Visual Studio Installer",
            "JetBrains Toolbox",
            "IntelliJ IDEA Community Edition 2025.1",
            "PyCharm 2025.2",
            "WebStorm",
            "CLion",
            "GoLand",
            "Rider",
            "Android Studio",
            "Cursor",
            "Windsurf",
            "Antigravity",
            "Sublime Text",
            "Notepad++",
            "Vim",
            "gVim",
            "Emacs",
            "Eclipse IDE for Java Developers",
            "Arduino IDE 2",
            "Git Bash",
            "Git GUI",
            "GitHub Desktop",
            "GitKraken",
            "Sourcetree",
            "Terminal",
            "Windows Terminal",
            "PowerShell 7 (x64)",
            "WSL",
            "Ubuntu 22.04 LTS",
            "PuTTY (64-bit)",
            "Docker Desktop",
            "Postman",
            "Insomnia",
            "Node.js",
            "Python 3.12 (64-bit)",
            "IDLE (Python 3.12 64-bit)",
            "Anaconda Navigator",
            "Jupyter Notebook",
            "DBeaver",
            "pgAdmin 4",
            "MySQL Workbench",
            "MongoDB Compass",
            "Wireshark",
            "WinMerge",
            "WinSCP",
            "Unity Hub",
            "Godot Engine",
            "Dev Home",
            "Google Cloud SDK Shell",
        ]),
    );
    assert_all(
        Ai,
        FiledBy::Known,
        &by_name(&[
            "ChatGPT",
            "Claude",
            "Gemini",
            "Microsoft Copilot",
            "Copilot",
            "Perplexity",
            "LM Studio",
            "Ollama",
            "DeepSeek",
            "Grok",
            "GPT4All",
        ]),
    );
    assert_all(
        Communication,
        FiledBy::Known,
        &by_name(&[
            "Discord",
            "Slack",
            "Microsoft Teams (work or school)",
            "Zoom Workplace",
            "WhatsApp",
            "Telegram Desktop",
            "Signal",
            "Skype",
            "Outlook",
            "Outlook (new)",
            "Mail",
            "Thunderbird",
            "Mozilla Thunderbird",
            "Phone Link",
            "Viber",
            "Messenger",
            "Instagram",
            "Twitter",
            "Reddit",
            "WebEx",
        ]),
    );
    assert_all(
        Productivity,
        FiledBy::Known,
        &by_name(&[
            "Word",
            "Excel",
            "PowerPoint",
            "OneNote",
            "Microsoft 365 (Office)",
            "Notion",
            "Obsidian",
            "Todoist",
            "Evernote",
            "Calendar",
            "Microsoft To Do",
            "Sticky Notes",
            "LibreOffice Writer",
            "WPS Office",
            "Adobe Acrobat Reader",
            "Foxit PDF Reader",
            "SumatraPDF",
            "OneDrive",
            "Dropbox",
            "Zotero",
            "Trello",
            "Miro",
        ]),
    );
    assert_all(
        Creative,
        FiledBy::Known,
        &by_name(&[
            "Adobe Photoshop 2025",
            "Adobe Illustrator 2025",
            "Adobe Premiere Pro 2025",
            "Adobe After Effects 2025",
            "Adobe Lightroom Classic",
            "Adobe Creative Cloud",
            "Figma",
            "Blender 4.2",
            "GIMP 2.10.36",
            "Krita",
            "Inkscape",
            "DaVinci Resolve",
            "OBS Studio",
            "Affinity Photo 2",
            "Canva",
            "Paint",
            "Paint.NET",
            "Audacity",
            "FL Studio 21",
            "Ableton Live 12 Suite",
            "Autodesk Maya 2025",
            "SketchUp 2024",
            "CapCut",
            "HandBrake",
            "Camtasia",
        ]),
    );
    assert_all(
        Games,
        FiledBy::Known,
        &by_name(&[
            "Steam",
            "Epic Games Launcher",
            "Xbox",
            "Battle.net",
            "Riot Client",
            "VALORANT",
            "League of Legends",
            "EA app",
            "Ubisoft Connect",
            "GOG GALAXY",
            "Minecraft Launcher",
            "Roblox Player",
            "Rockstar Games Launcher",
            "Genshin Impact",
            "Playnite",
            "Solitaire & Casual Games",
        ]),
    );
    assert_all(
        Media,
        FiledBy::Known,
        &by_name(&[
            "Spotify",
            "VLC media player",
            "Media Player",
            "Windows Media Player Legacy",
            "Netflix",
            "iTunes",
            "Apple Music",
            "Photos",
            "Movies & TV",
            "MPC-HC x64",
            "PotPlayer",
            "Kodi",
            "foobar2000",
            "Plex",
            "YouTube Music",
            "Camera",
        ]),
    );
    assert_all(
        Utilities,
        FiledBy::Known,
        &by_name(&[
            "7-Zip File Manager",
            "WinRAR",
            "NanaZip",
            "Everything",
            "PowerToys (Preview)",
            "Calculator",
            "Notepad",
            "Snipping Tool",
            "ShareX",
            "Greenshot",
            "CCleaner",
            "WizTree",
            "Rufus",
            "qBittorrent",
            "CPU-Z",
            "HWiNFO64",
            "NVIDIA App",
            "GeForce Experience",
            "Logitech G HUB",
            "Razer Synapse",
            "MSI Afterburner",
            "VMware Workstation",
            "Oracle VM VirtualBox",
            "TeamViewer",
            "AnyDesk",
            "NordVPN",
            "Bitwarden",
            "1Password",
            "KeePassXC",
            "Malwarebytes",
            "Character Map",
            "Remote Desktop Connection",
            "Clock",
            "Weather",
            "FileZilla",
        ]),
    );
    assert_all(
        System,
        FiledBy::Known,
        &by_name(&[
            "Settings",
            "Control Panel",
            "Task Manager",
            "File Explorer",
            "Windows Security",
            "Registry Editor",
            "Command Prompt",
            "Windows PowerShell",
            "Windows PowerShell ISE",
            "Services",
            "Event Viewer",
            "Computer Management",
            "Task Scheduler",
            "Microsoft Store",
            "Feedback Hub",
            "Windows Backup",
            "Narrator",
            "Run",
        ]),
    );
}

#[test]
fn known_apps_by_executable_and_id() {
    use Builtin::*;
    assert_all(Browsers, FiledBy::Known, &[("Internet", "", "", "", "chrome.exe"), ("Web", "", "", "", "msedge.exe")]);
    assert_all(Development, FiledBy::Known, &[("Editor", "", "", "", "code.exe"), ("IDE", "", "", "", "idea64.exe")]);
    assert_all(Communication, FiledBy::Known, &[("Chatty", "", "", "com.squirrel.discord.discord", "")]);
    assert_all(Utilities, FiledBy::Known, &[("Calc", "", "", "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App", "")]);
    assert_all(Games, FiledBy::Known, &[("Launcher", "", "", "", "steam.exe")]);
}

#[test]
fn name_patterns_respect_word_boundaries() {
    // `steam*` is the word "steam", not any name that starts with those letters.
    assert_ne!(run(("Steamroller Pro", "", "", "", "")).category.as_str(), "games");
    // `git*` must not take "Gitless" or "Digital Painter".
    assert_ne!(run(("Gitless Notes", "", "", "", "")).category.as_str(), "development");
    // `x` the social network is an exact name, not any app starting with x.
    assert_ne!(run(("Xmind", "", "", "", "")).category.as_str(), "communication");
    // An exact pattern does not match a longer name.
    assert_ne!(run(("Word Counter Pro", "", "", "", "")).filed_by, FiledBy::Known);
}

#[test]
fn aumid_patterns_are_prefixes() {
    assert_eq!(run(("Thing", "", "", "Chrome.Canary", "")).category.as_str(), "browsers");
    assert_eq!(run(("Thing", "", "", "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify", "")).category.as_str(), "media");
    assert_eq!(run(("Thing", "", "", "NotChrome", "")).filed_by, FiledBy::Fallback);
}

#[test]
fn store_rules_apply_to_packaged_apps_only() {
    let packaged = |name: &str, aumid: &str| {
        let s = Subject { packaged: true, ..Subject::of(name, "", "", aumid, "") };
        classify(&s, None)
    };
    let c = packaged("Mystery Client", "MicrosoftWindows.Client.CBS_cw5n1h2txyewy!Mystery");
    assert_eq!((c.category.as_str(), c.filed_by), ("system", FiledBy::Store));
    let c = packaged("Mystery Title", "www.msn.com-C814FC15_q77jw2zwjvy92!App");
    assert_eq!((c.category.as_str(), c.filed_by), ("games", FiledBy::Store));
    // The same id on a desktop app is not a package identity.
    let c = run(("Mystery Title", "", "", "www.msn.com-C814FC15_q77jw2zwjvy92!App", ""));
    assert_eq!(c.filed_by, FiledBy::Fallback);
}

#[test]
fn protocol_launchers_are_games() {
    let s = Subject { target: "steam://rungameid/1815780".into(), ..Subject::of("Mystery Title", "", "", "", "") };
    let c = classify(&s, None);
    assert_eq!((c.category.as_str(), c.filed_by), ("games", FiledBy::Rule));
}

#[test]
fn start_menu_folders_file_the_whole_vendor() {
    assert_all(Builtin::Creative, FiledBy::Rule, &[("Mystery Plugin Manager", "", "Adobe", "", "")]);
    assert_all(Builtin::System, FiledBy::Rule, &[("Mystery Panel", "", "Administrative Tools", "", "")]);
    assert_all(Builtin::System, FiledBy::Rule, &[("Mystery Panel", "", "Accessibility", "", "")]);
    assert_all(Builtin::Utilities, FiledBy::Rule, &[("Mystery", "", "Accessories", "", "")]);
    assert_all(Builtin::Development, FiledBy::Rule, &[("Mystery Thing", "", "JetBrains", "", "")]);
    assert_all(Builtin::Games, FiledBy::Rule, &[("Mystery", "", "Riot Games", "", "")]);
    // A folder only counts from its first word.
    assert_eq!(run(("Mystery", "", "Not Adobe", "", "")).filed_by, FiledBy::Fallback);
}

#[test]
fn publishers_file_unknown_apps() {
    assert_all(
        Builtin::Games,
        FiledBy::Rule,
        &[
            ("Hades II", "Supergiant Games", "", "", ""),
            ("Anker Launcher", "ankergames", "", "", ""),
            ("Mystery Title", "Microsoft Studios", "", "", ""),
        ],
    );
    assert_all(Builtin::Creative, FiledBy::Rule, &[("Mystery Brush", "Adobe Inc.", "", "", "")]);
    assert_all(Builtin::Development, FiledBy::Rule, &[("Mystery Tool", "JetBrains s.r.o.", "", "", "")]);
    assert_all(Builtin::Utilities, FiledBy::Rule, &[("Mystery Hub", "Lenovo Group", "", "", "")]);
    // The publisher of every Microsoft app says nothing about the category.
    assert_eq!(run(("Mystery", "Microsoft Corporation", "", "", "")).filed_by, FiledBy::Fallback);
}

#[test]
fn keywords_in_the_name_file_unknown_apps() {
    assert_all(
        Builtin::Creative,
        FiledBy::Rule,
        &[("Super Photo Editor", "", "", "", ""), ("Pixel Drawing Pad", "", "", "", "")],
    );
    assert_all(Builtin::Media, FiledBy::Rule, &[("My Music Player", "", "", "", ""), ("Radio Tuner", "", "", "", "")]);
    assert_all(Builtin::Communication, FiledBy::Rule, &[("Acme Chat", "", "", "", ""), ("Acme Meet", "", "", "", "")]);
    assert_all(
        Builtin::Productivity,
        FiledBy::Rule,
        &[("Todo Master", "", "", "", ""), ("Acme PDF Studio", "", "", "", "")],
    );
    assert_all(
        Builtin::Utilities,
        FiledBy::Rule,
        &[("Cool Zip Tool", "", "", "", ""), ("Acme Disk Cleaner", "", "", "", "")],
    );
    assert_all(Builtin::Games, FiledBy::Rule, &[("Acme Game Hub", "", "", "", ""), ("Super Chess", "", "", "", "")]);
    assert_all(
        Builtin::Ai,
        FiledBy::Rule,
        &[("Acme AI Assistant", "", "", "", ""), ("Local LLM Runner", "", "", "", "")],
    );
    assert_all(Builtin::Browsers, FiledBy::Rule, &[("Acme Web Browser", "", "", "", "")]);
    assert_all(
        Builtin::Development,
        FiledBy::Rule,
        &[("Acme SDK Manager", "", "", "", ""), ("Acme Git Client", "", "", "", "")],
    );
    assert_all(Builtin::System, FiledBy::Rule, &[("Mystery Settings", "", "", "", "")]);
}

#[test]
fn every_group_pattern_is_well_formed() {
    // Lower case, no stray spaces, a known prefix: a typo in the table would otherwise silently never match.
    for group in TABLE {
        for pattern in group.patterns {
            let (kind, value) = pattern.split_once(':').unwrap_or_else(|| panic!("no kind in `{pattern}`"));
            assert!(["name", "exe", "aumid"].contains(&kind), "unknown kind in `{pattern}`");
            assert_eq!(*pattern, pattern.to_lowercase(), "`{pattern}` is not lower case");
            assert_eq!(value.trim(), value, "`{pattern}` has stray spaces");
            assert!(!value.is_empty(), "`{pattern}` is empty");
            if kind == "name" {
                let stem = value.strip_suffix('*').unwrap_or(value);
                assert_eq!(normalise_name(stem), stem, "`{pattern}` is not in normalised form");
            }
        }
    }
    for rule in rules::NAME.iter().chain(rules::FOLDER).chain(rules::PUBLISHER) {
        for phrase in rule.phrases {
            let stem = phrase.strip_suffix('*').unwrap_or(phrase);
            assert_eq!(normalise_name(stem), stem, "rule phrase `{phrase}` is not in normalised form");
        }
    }
}

#[test]
fn no_pattern_is_listed_for_two_categories() {
    let mut seen = std::collections::HashMap::new();
    for group in TABLE {
        for pattern in group.patterns {
            if let Some(first) = seen.insert(*pattern, group.category) {
                panic!("`{pattern}` is in both {} and {}", first.as_str(), group.category.as_str());
            }
        }
    }
}

/// Every app on the machine the classifier was reviewed on: name, publisher, folder, AUMID, exe, protocol
/// URL, `packaged` and the category a person put it in after reading the list. Apps nobody could name are
/// left out. See `docs/spikes/DOCK_CLASSIFIER.md`.
const GOLDEN: &str = include_str!("golden.tsv");

#[test]
fn reviewed_machine_apps_stay_where_they_were_filed() {
    let mut wrong = Vec::new();
    let mut total = 0;
    for line in GOLDEN.lines().filter(|l| !l.trim().is_empty()) {
        let f: Vec<&str> = line.split('\t').collect();
        assert_eq!(f.len(), 8, "bad golden row `{line}`");
        total += 1;
        let subject = Subject {
            target: f[5].to_lowercase(),
            packaged: f[6] == "packaged",
            ..Subject::of(f[0], f[1], f[2], f[3], f[4])
        };
        let got = classify(&subject, None);
        if got.category.as_str() != f[7] {
            wrong.push(format!("{}: expected {} got {}", f[0], f[7], got.category));
        }
    }
    assert!(total > 150, "the golden list shrank to {total} rows");
    assert!(wrong.is_empty(), "{wrong:#?}");
}
