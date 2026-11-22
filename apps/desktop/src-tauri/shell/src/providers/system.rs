use serde::Serialize;
use sysinfo::{CpuRefreshKind, Disks, MemoryRefreshKind, RefreshKind, System};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiskData {
    pub mount: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SystemData {
    pub mem_total_bytes: u64,
    pub mem_used_bytes: u64,
    pub cpu_percent: f32,
    pub disks: Vec<DiskData>,
}

pub struct SystemProvider {
    sys: System,
    /// None when the volume list cannot be read; RAM and CPU still work.
    disks: Option<Disks>,
    cached_disks: Vec<DiskData>,
}

impl SystemProvider {
    pub fn new() -> Result<Self, sysinfo::Error> {
        let sys = System::new_with_specifics(
            RefreshKind::nothing()
                .with_memory(MemoryRefreshKind::nothing().with_ram())
                .with_cpu(CpuRefreshKind::nothing().with_usage()),
        )?;
        Ok(Self { sys, disks: Disks::new().ok(), cached_disks: Vec::new() })
    }

    pub fn sample(&mut self, refresh_disks: bool) -> SystemData {
        self.sys.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());
        self.sys.refresh_cpu_usage();
        if refresh_disks {
            if let Some(disks) = self.disks.as_mut() {
                disks.refresh(true);
                self.cached_disks = system_drive_first(disks);
            }
        }
        SystemData {
            mem_total_bytes: self.sys.total_memory(),
            mem_used_bytes: self.sys.used_memory(),
            cpu_percent: self.sys.global_cpu_usage(),
            disks: self.cached_disks.clone(),
        }
    }
}

/// Fixed local drives, with the Windows system drive first (the disk widget shows the first).
fn system_drive_first(disks: &Disks) -> Vec<DiskData> {
    let system_drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".to_owned());
    let mut out: Vec<DiskData> = disks
        .iter()
        .filter(|d| !d.is_removable() && d.total_space() > 0)
        .map(|d| {
            let mount = d.mount_point().to_string_lossy().trim_end_matches('\\').to_owned();
            DiskData {
                mount,
                total_bytes: d.total_space(),
                used_bytes: d.total_space().saturating_sub(d.available_space()),
            }
        })
        .collect();
    out.sort_by_key(|d| (!d.mount.eq_ignore_ascii_case(&system_drive), d.mount.clone()));
    out
}
