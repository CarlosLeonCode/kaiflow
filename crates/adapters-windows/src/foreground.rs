//! Reading the foreground window: owning process, executable, display name and title.

use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::{Mutex, PoisonError};

use adapters_common::activation::Activation;
use windows::Win32::Foundation::{CloseHandle, HWND};
use windows::Win32::Storage::FileSystem::{
    GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
};
use windows::core::{PCWSTR, PWSTR, w};

use crate::naming::{MAX_DESCRIPTIONS, description_keys, identity_from_exe, text_from_utf16};

/// Longest image path read (the documented maximum for extended-length paths).
const MAX_IMAGE_PATH: usize = 32_768;

/// `HWND` <-> plain id, so activations stay `Send` (an `HWND` is a raw pointer).
pub fn hwnd_to_id(hwnd: HWND) -> u64 {
    hwnd.0 as usize as u64
}

pub fn id_to_hwnd(id: u64) -> HWND {
    HWND(id as usize as *mut c_void)
}

/// `FileDescription` per executable path. Reading the version resource touches the file,
/// so each executable is read once; misses are cached too.
#[derive(Debug, Default)]
pub struct DescriptionCache(Mutex<HashMap<String, Option<String>>>);

impl DescriptionCache {
    pub fn describe(&self, path: &str) -> Option<String> {
        if let Some(cached) = self
            .0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(path)
        {
            return cached.clone();
        }
        let description = file_description(path);
        let mut map = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        if map.len() >= MAX_DESCRIPTIONS {
            map.clear();
        }
        map.insert(path.to_owned(), description.clone());
        description
    }
}

/// The application owning the foreground window; `None` while no window has the focus
/// (switching, secure desktop) or when the process cannot be queried.
pub fn foreground_activation(cache: &DescriptionCache) -> Option<Activation> {
    // SAFETY: no arguments; returns null when there is no foreground window.
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_invalid() {
        return None;
    }
    activation_for(hwnd, cache)
}

pub fn activation_for(hwnd: HWND, cache: &DescriptionCache) -> Option<Activation> {
    let mut pid = 0_u32;
    // SAFETY: `pid` outlives the call; an invalid window simply yields pid 0.
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == 0 {
        return None;
    }
    let path = process_image(pid)?;
    let description = cache.describe(&path);
    let identity = identity_from_exe(&path, description.as_deref())?;
    Some(Activation {
        pid: i32::try_from(pid).ok()?,
        identity,
        window: Some(hwnd_to_id(hwnd)),
    })
}

/// Full Win32 path of the process image. `PROCESS_QUERY_LIMITED_INFORMATION` also works for
/// elevated processes when this one is not elevated.
fn process_image(pid: u32) -> Option<String> {
    // SAFETY: plain handle request; the handle is closed below.
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let mut buffer = vec![0_u16; MAX_IMAGE_PATH];
    let mut len = buffer.len() as u32;
    // SAFETY: `buffer` holds `len` u16s; `len` receives the written length.
    let result = unsafe {
        QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut len,
        )
    };
    // SAFETY: `process` was returned by OpenProcess and is closed exactly once.
    let _ = unsafe { CloseHandle(process) };
    result.ok()?;
    let written = (len as usize).min(buffer.len());
    text_from_utf16(&buffer[..written])
}

/// Title of `hwnd`. For windows of other processes Windows returns the cached caption
/// without sending `WM_GETTEXT`, so a hung application cannot block the sampler.
pub fn window_title(hwnd: HWND) -> Option<String> {
    // SAFETY: an invalid window returns 0.
    let len = unsafe { GetWindowTextLengthW(hwnd) };
    let len = usize::try_from(len).ok().filter(|&l| l > 0)?;
    let mut buffer = vec![0_u16; len + 1];
    // SAFETY: the slice is valid for its whole length.
    let copied = unsafe { GetWindowTextW(hwnd, &mut buffer) };
    let copied = usize::try_from(copied).ok().filter(|&c| c > 0)?;
    text_from_utf16(&buffer[..copied.min(buffer.len())])
}

fn to_wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// `FileDescription` from the executable's version resource ("Visual Studio Code").
fn file_description(path: &str) -> Option<String> {
    let wide_path = to_wide(path);
    let name = PCWSTR(wide_path.as_ptr());
    // SAFETY: `name` is a NUL-terminated UTF-16 string that outlives the calls.
    let size = unsafe { GetFileVersionInfoSizeW(name, None) };
    if size == 0 {
        return None;
    }
    // u32 storage keeps the block aligned for the u16 reads below.
    let mut block = vec![0_u32; (size as usize).div_ceil(4)];
    // SAFETY: `block` has at least `size` bytes.
    unsafe { GetFileVersionInfoW(name, None, size, block.as_mut_ptr().cast()) }.ok()?;
    let block_ptr: *const c_void = block.as_ptr().cast();

    let translations = query_u16(block_ptr, w!("\\VarFileInfo\\Translation"), false);
    for key in description_keys(&translations) {
        let wide_key = to_wide(&key);
        let value = query_u16(block_ptr, PCWSTR(wide_key.as_ptr()), true);
        if let Some(text) = text_from_utf16(&value) {
            return Some(text);
        }
    }
    None
}

/// Reads one value of a version block as UTF-16 units. For string values `VerQueryValueW`
/// reports the length in characters; for binary values (the translation table) in bytes.
fn query_u16(block: *const c_void, sub_block: PCWSTR, is_string: bool) -> Vec<u16> {
    let mut value: *mut c_void = std::ptr::null_mut();
    let mut len = 0_u32;
    // SAFETY: `block` is a version block filled by GetFileVersionInfoW and `sub_block` a
    // NUL-terminated string; on success `value` points inside `block`.
    let ok = unsafe { VerQueryValueW(block, sub_block, &mut value, &mut len) };
    if !ok.as_bool() || value.is_null() || len == 0 {
        return Vec::new();
    }
    let units = if is_string {
        len as usize
    } else {
        len as usize / 2
    };
    // SAFETY: the API guarantees `len` valid units at `value`, inside the aligned block.
    unsafe { std::slice::from_raw_parts(value as *const u16, units) }.to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_ids_round_trip() {
        let hwnd = id_to_hwnd(0x1234);
        assert_eq!(hwnd_to_id(hwnd), 0x1234);
    }

    #[test]
    fn this_process_has_a_readable_image_path() {
        let path = process_image(std::process::id()).expect("own image path");
        assert!(path.to_lowercase().ends_with(".exe"), "{path}");
    }

    #[test]
    #[ignore = "needs an interactive desktop session with a foreground window"]
    fn the_foreground_window_is_readable() {
        let cache = DescriptionCache::default();
        let activation = foreground_activation(&cache).expect("a foreground window");
        let _ = window_title(id_to_hwnd(activation.window.unwrap()));
    }
}
