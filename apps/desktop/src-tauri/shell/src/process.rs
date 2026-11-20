//! A handle to one process: when it started, whether it still runs, and a blocking wait.
//! A process is identified by its pid plus its start time, so a reused pid is never taken for it.

use windows::Win32::Foundation::{CloseHandle, FILETIME, HANDLE, WAIT_TIMEOUT};
use windows::Win32::System::Threading::{
    GetProcessTimes, OpenProcess, WaitForSingleObject, INFINITE, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
};

pub(crate) struct Process(HANDLE);

impl Drop for Process {
    fn drop(&mut self) {
        // SAFETY: the handle came from a successful OpenProcess and is closed once.
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

impl Process {
    /// `None` when no such process exists (it has ended and nothing holds a handle to it).
    pub(crate) fn open(pid: u32) -> Option<Self> {
        // SAFETY: plain handle lookup by pid; the access rights are the two this type needs.
        unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE, false, pid) }.ok().map(Self)
    }

    /// Creation time as a `FILETIME` tick count.
    pub(crate) fn started(&self) -> Option<u64> {
        let (mut created, mut exited, mut kernel, mut user) =
            (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
        // SAFETY: four valid out-pointers to local FILETIMEs and a live process handle.
        unsafe { GetProcessTimes(self.0, &mut created, &mut exited, &mut kernel, &mut user) }.ok()?;
        Some((u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime))
    }

    /// False once the process has ended, even while other programs still hold handles to it.
    pub(crate) fn is_running(&self) -> bool {
        // SAFETY: a zero-timeout wait on a live handle only reads its signalled state.
        unsafe { WaitForSingleObject(self.0, 0) == WAIT_TIMEOUT }
    }

    /// Blocks until the process ends.
    pub(crate) fn wait(&self) {
        // SAFETY: waiting on a live handle with no timeout.
        unsafe {
            WaitForSingleObject(self.0, INFINITE);
        }
    }
}
