//! Process facts the island needs: who launched the hook, and whether a session's process is still alive.
//!
//! A process is identified by its id plus its creation time (a Windows FILETIME), because ids are reused.

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use windows::Wdk::System::Threading::{NtQueryInformationProcess, ProcessBasicInformation};
    use windows::Win32::Foundation::{CloseHandle, FILETIME, HANDLE, STILL_ACTIVE};
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{
        GetCurrentProcess, GetExitCodeProcess, GetProcessTimes, OpenProcess, PROCESS_BASIC_INFORMATION,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    /// Closes the handle on drop.
    struct Owned(HANDLE);

    impl Drop for Owned {
        fn drop(&mut self) {
            // SAFETY: the handle came from a successful OpenProcess/CreateToolhelp32Snapshot and is closed once.
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    fn open(pid: u32) -> Option<Owned> {
        // SAFETY: plain FFI call; the returned handle is owned by `Owned`.
        unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok().map(Owned) }
    }

    fn filetime_to_u64(ft: FILETIME) -> u64 {
        (u64::from(ft.dwHighDateTime) << 32) | u64::from(ft.dwLowDateTime)
    }

    fn times(handle: &Owned) -> Option<(u64, u64)> {
        let (mut created, mut exited, mut kernel, mut user) =
            (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
        // SAFETY: all four out-pointers point to live FILETIME values on this stack frame.
        unsafe { GetProcessTimes(handle.0, &mut created, &mut exited, &mut kernel, &mut user).ok()? };
        Some((filetime_to_u64(created), filetime_to_u64(exited)))
    }

    pub fn parent_pid() -> Option<u32> {
        let mut info = PROCESS_BASIC_INFORMATION::default();
        let mut returned = 0u32;
        // SAFETY: `info` is a correctly sized PROCESS_BASIC_INFORMATION and the pseudo-handle of the current
        // process needs no closing.
        let status = unsafe {
            NtQueryInformationProcess(
                GetCurrentProcess(),
                ProcessBasicInformation,
                std::ptr::from_mut(&mut info).cast::<c_void>(),
                u32::try_from(std::mem::size_of::<PROCESS_BASIC_INFORMATION>()).ok()?,
                &mut returned,
            )
        };
        if status.is_err() {
            return None;
        }
        u32::try_from(info.InheritedFromUniqueProcessId).ok().filter(|p| *p != 0)
    }

    pub fn creation_time(pid: u32) -> Option<u64> {
        times(&open(pid)?).map(|(created, _)| created)
    }

    pub fn is_alive(pid: u32, start: Option<u64>) -> bool {
        let Some(handle) = open(pid) else { return false };
        let mut code = 0u32;
        // SAFETY: `code` is a live u32 on this stack frame.
        if unsafe { GetExitCodeProcess(handle.0, &mut code) }.is_err() || code != STILL_ACTIVE.0 as u32 {
            return false;
        }
        match (start, times(&handle)) {
            (Some(expected), Some((created, _))) => created == expected,
            _ => true,
        }
    }

    pub fn table() -> Vec<super::ProcessEntry> {
        // SAFETY: snapshot handle is owned by `Owned`; `entry` is initialised with its size as the API requires.
        unsafe {
            let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return Vec::new() };
            let snapshot = Owned(snapshot);
            let mut entry =
                PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
            let mut out = Vec::new();
            let mut more = Process32FirstW(snapshot.0, &mut entry).is_ok();
            while more {
                let len = entry.szExeFile.iter().position(|c| *c == 0).unwrap_or(entry.szExeFile.len());
                out.push(super::ProcessEntry {
                    pid: entry.th32ProcessID,
                    parent: entry.th32ParentProcessID,
                    exe: String::from_utf16_lossy(&entry.szExeFile[..len]),
                });
                more = Process32NextW(snapshot.0, &mut entry).is_ok();
            }
            out
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn parent_pid() -> Option<u32> {
        None
    }
    pub fn creation_time(_pid: u32) -> Option<u64> {
        None
    }
    pub fn is_alive(_pid: u32, _start: Option<u64>) -> bool {
        true
    }
    pub fn table() -> Vec<super::ProcessEntry> {
        Vec::new()
    }
}

/// One row of the process list.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProcessEntry {
    pub pid: u32,
    pub parent: u32,
    pub exe: String,
}

/// Process id of whoever started this process (Claude Code, for the hook).
pub fn parent_pid() -> Option<u32> {
    imp::parent_pid()
}

/// Creation time of a process as a Windows FILETIME (100 ns ticks since 1601).
pub fn creation_time(pid: u32) -> Option<u64> {
    imp::creation_time(pid)
}

/// True while the process exists and, when `start` is given, is still the same process (not a reused id).
pub fn is_alive(pid: u32, start: Option<u64>) -> bool {
    imp::is_alive(pid, start)
}

/// Snapshot of all processes. Slow (milliseconds); the hook never calls it.
pub fn table() -> Vec<ProcessEntry> {
    imp::table()
}

/// `pid` followed by its parents, nearest first, stopping at a missing parent or after `max` steps.
pub fn ancestry(table: &[ProcessEntry], pid: u32, max: usize) -> Vec<u32> {
    let mut chain = vec![pid];
    let mut current = pid;
    while chain.len() <= max {
        let Some(parent) = table.iter().find(|e| e.pid == current).map(|e| e.parent) else { break };
        if parent == 0 || chain.contains(&parent) {
            break;
        }
        chain.push(parent);
        current = parent;
    }
    chain
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(pid: u32, parent: u32) -> ProcessEntry {
        ProcessEntry { pid, parent, exe: format!("p{pid}.exe") }
    }

    #[test]
    fn ancestry_walks_up_and_stops_on_cycles_and_limits() {
        let table = [entry(30, 20), entry(20, 10), entry(10, 0), entry(40, 41), entry(41, 40)];
        assert_eq!(ancestry(&table, 30, 10), vec![30, 20, 10]);
        assert_eq!(ancestry(&table, 40, 10), vec![40, 41]);
        assert_eq!(ancestry(&table, 30, 1), vec![30, 20]);
        assert_eq!(ancestry(&table, 999, 5), vec![999]);
    }

    #[cfg(windows)]
    #[test]
    fn this_process_is_alive_and_has_a_parent() {
        let me = std::process::id();
        let start = creation_time(me).expect("creation time of self");
        assert!(is_alive(me, Some(start)));
        assert!(!is_alive(me, Some(start + 1)), "a different creation time means a reused pid");
        assert!(parent_pid().is_some());
        let entries = table();
        assert!(entries.iter().any(|e| e.pid == me));
    }

    #[cfg(windows)]
    #[test]
    fn a_pid_that_does_not_exist_is_not_alive() {
        assert!(!is_alive(u32::MAX - 3, None));
    }
}
