//! The service's commands, run against a real service on a scratch folder. They do not depend on which apps are
//! installed: they check what the commands refuse, what they persist and what they announce. Starting a service
//! scans the Start menu (a few seconds), so the checks that can share one service do.
#![cfg(windows)]

use dotdock_dock::protocol::{
    Builtin, Category, CategoryId, CommandResult, DockEdge, DockEvent, DockSettings, PreviewArgs,
};
use dotdock_dock::service::{DockService, ServiceConfig};
use dotdock_dock::store::{StoreData, STORE_FILE};
use std::sync::mpsc::Receiver;
use std::time::Duration;

fn start(dir: &std::path::Path) -> (DockService, Receiver<DockEvent>) {
    DockService::start(ServiceConfig { data_dir: dir.join("data"), icon_dir: dir.join("icons") }).expect("start")
}

fn refused(result: CommandResult) -> bool {
    matches!(result, CommandResult::Failed { .. })
}

#[test]
fn the_service_can_live_in_shared_state() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<DockService>();
}

#[test]
fn commands_refuse_what_they_cannot_do_and_keep_the_categories_sound() {
    let dir = tempfile::tempdir().unwrap();
    let (service, _events) = start(dir.path());

    // A new store starts with the default categories.
    assert_eq!(service.snapshot().categories, Category::defaults());

    // Commands on things that do not exist.
    assert!(refused(service.launch("no such app")));
    assert!(refused(service.activate("not a handle")));
    assert!(refused(service.close_window("not a handle")));
    assert!(refused(service.set_category("no such app", Builtin::Games.into())));
    assert!(refused(service.set_category("no such app", CategoryId::parse("custom:unknown").unwrap())));

    // Settings the dock cannot draw.
    assert!(refused(service.set_settings(DockSettings { icon_size: 0, ..DockSettings::default() })));

    // "Other" always stays and ids stay unique.
    let all = Category::defaults();
    let without_other: Vec<Category> = all.iter().filter(|c| c.id.as_str() != "other").cloned().collect();
    assert!(refused(service.save_categories(without_other)));
    let mut doubled = all.clone();
    doubled.push(all[0].clone());
    assert!(refused(service.save_categories(doubled)));
    assert!(service.save_categories(all).is_ok());

    // Hiding previews with nothing shown, and a bad handle, are harmless.
    service.preview(0, 1.0, 1000, &PreviewArgs { hwnds: vec![], anchor: None });
    service.preview(0, 1.0, 1000, &PreviewArgs { hwnds: vec!["not a handle".into()], anchor: None });

    // Icon URLs outside the cache name no file.
    assert!(service.icon_file("dock-icon://../../x.png", Duration::from_millis(10)).is_none());
    assert!(service.icon_file("dock-icon://0123456789abcdef.png", Duration::from_millis(10)).is_none());
}

#[test]
fn settings_are_announced_and_survive_a_restart() {
    let dir = tempfile::tempdir().unwrap();
    let wanted = DockSettings { edge: DockEdge::Left, icon_size: 64, auto_hide: true, ..DockSettings::default() };
    {
        let (service, events) = start(dir.path());
        assert!(service.set_settings(wanted.clone()).is_ok());
        let announced = std::iter::from_fn(|| events.recv_timeout(Duration::from_secs(5)).ok()).find_map(|e| {
            if let DockEvent::Settings(s) = e {
                Some(s)
            } else {
                None
            }
        });
        assert_eq!(announced, Some(wanted.clone()));
        assert_eq!(service.snapshot().settings, wanted);
        // Dropping the service flushes the debounced write, so a quick exit loses nothing.
    }
    let on_disk = StoreData::load(&dir.path().join("data").join(STORE_FILE));
    assert_eq!(on_disk.settings, wanted);
    let (service, _events) = start(dir.path());
    assert_eq!(service.snapshot().settings, wanted);
}
