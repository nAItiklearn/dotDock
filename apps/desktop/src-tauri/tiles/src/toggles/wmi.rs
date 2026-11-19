//! The one WMI call the brightness tile needs: `WmiMonitorBrightnessMethods.WmiSetBrightness`.
//!
//! This is the documented route for changing a laptop panel's brightness immediately; the power plan's value
//! is written separately so the level survives a power-source change.

use windows::core::{BSTR, PCWSTR};
use windows::Win32::System::Com::{
    CoCreateInstance, CoSetProxyBlanket, CLSCTX_INPROC_SERVER, EOAC_NONE, RPC_C_AUTHN_LEVEL_CALL,
    RPC_C_IMP_LEVEL_IMPERSONATE,
};
use windows::Win32::System::Rpc::{RPC_C_AUTHN_WINNT, RPC_C_AUTHZ_NONE};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::System::Wmi::{
    IEnumWbemClassObject, IWbemClassObject, IWbemLocator, IWbemServices, WbemLocator, WBEM_FLAG_FORWARD_ONLY,
    WBEM_FLAG_RETURN_IMMEDIATELY, WBEM_INFINITE,
};

const NAMESPACE: &str = r"ROOT\WMI";
const CLASS: &str = "WmiMonitorBrightnessMethods";
const METHOD: &str = "WmiSetBrightness";
/// `CIM_UINT32` / `CIM_UINT8` are passed as VARIANT integers; WMI converts them to the method's declared types.
const TIMEOUT_NONE: i32 = 0;

fn connect() -> Result<IWbemServices, String> {
    crate::com::ensure();
    // SAFETY: standard WMI client setup; every interface is released on drop.
    unsafe {
        let locator: IWbemLocator =
            CoCreateInstance(&WbemLocator, None, CLSCTX_INPROC_SERVER).map_err(|e| format!("WMI: {e}"))?;
        let services = locator
            .ConnectServer(&BSTR::from(NAMESPACE), &BSTR::new(), &BSTR::new(), &BSTR::new(), 0, &BSTR::new(), None)
            .map_err(|e| format!("WMI connect: {e}"))?;
        CoSetProxyBlanket(
            &services,
            RPC_C_AUTHN_WINNT,
            RPC_C_AUTHZ_NONE,
            None,
            RPC_C_AUTHN_LEVEL_CALL,
            RPC_C_IMP_LEVEL_IMPERSONATE,
            None,
            EOAC_NONE,
        )
        .map_err(|e| format!("WMI security: {e}"))?;
        Ok(services)
    }
}

fn first_instance_path(services: &IWbemServices) -> Result<BSTR, String> {
    // SAFETY: the enumerator, object and VARIANT are released/cleared on drop.
    unsafe {
        let query = format!("SELECT * FROM {CLASS} WHERE Active = TRUE");
        let rows: IEnumWbemClassObject = services
            .ExecQuery(
                &BSTR::from("WQL"),
                &BSTR::from(query),
                WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY,
                None,
            )
            .map_err(|e| format!("WMI query: {e}"))?;
        let mut objects: [Option<IWbemClassObject>; 1] = [None];
        let mut returned = 0u32;
        rows.Next(WBEM_INFINITE, &mut objects, &mut returned).ok().map_err(|e| format!("WMI enumerate: {e}"))?;
        let object = objects[0].take().ok_or_else(|| "No built-in display reports brightness control".to_owned())?;
        let mut path = VARIANT::default();
        object
            .Get(PCWSTR(crate::com::wide("__PATH").as_ptr()), 0, &mut path, None, None)
            .map_err(|e| format!("WMI path: {e}"))?;
        BSTR::try_from(&path).map_err(|e| format!("WMI path: {e}"))
    }
}

/// Sets the built-in panel's brightness to `percent` immediately.
pub fn set_brightness(percent: u8) -> Result<(), String> {
    let services = connect()?;
    let path = first_instance_path(&services)?;
    // SAFETY: the class, signature and instance objects are COM objects released on drop; names are NUL-terminated.
    unsafe {
        let mut class: Option<IWbemClassObject> = None;
        services
            .GetObject(&BSTR::from(CLASS), Default::default(), None, Some(&mut class), None)
            .map_err(|e| format!("WMI class: {e}"))?;
        let class = class.ok_or_else(|| "WMI returned no class".to_owned())?;
        let mut signature: Option<IWbemClassObject> = None;
        class
            .GetMethod(PCWSTR(crate::com::wide(METHOD).as_ptr()), 0, &mut signature, std::ptr::null_mut())
            .map_err(|e| format!("WMI method: {e}"))?;
        let params = signature
            .ok_or_else(|| "WMI method has no parameters".to_owned())?
            .SpawnInstance(0)
            .map_err(|e| format!("WMI parameters: {e}"))?;
        params
            .Put(PCWSTR(crate::com::wide("Timeout").as_ptr()), 0, &VARIANT::from(TIMEOUT_NONE), 0)
            .map_err(|e| format!("WMI Timeout: {e}"))?;
        params
            .Put(PCWSTR(crate::com::wide("Brightness").as_ptr()), 0, &VARIANT::from(i32::from(percent)), 0)
            .map_err(|e| format!("WMI Brightness: {e}"))?;
        services
            .ExecMethod(&path, &BSTR::from(METHOD), Default::default(), None, &params, None, None)
            .map_err(|e| format!("Windows would not change the brightness: {e}"))
    }
}
