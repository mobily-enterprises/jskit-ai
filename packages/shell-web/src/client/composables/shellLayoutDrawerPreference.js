import { pageStorage } from "../browser.js";

const SHELL_LAYOUT_DRAWER_DEFAULT_OPEN_STORAGE_KEY = "jskit.shell-web.drawer-default-open";

/**
 * @param {object} [options]
 * @param {Pick<Storage, "getItem"> | null} [options.storage] Null outside a browser.
 */
function readDrawerDefaultOpenPreference({ storage = pageStorage() } = {}) {
  if (!storage) {
    return true;
  }

  try {
    const storedValue = String(storage.getItem(SHELL_LAYOUT_DRAWER_DEFAULT_OPEN_STORAGE_KEY) || "").trim().toLowerCase();
    if (storedValue === "false") {
      return false;
    }
    if (storedValue === "true") {
      return true;
    }
  } catch {
    return true;
  }

  return true;
}

/**
 * @param {boolean} open
 * @param {object} [options]
 * @param {Pick<Storage, "setItem"> | null} [options.storage] Null outside a browser.
 */
function writeDrawerDefaultOpenPreference(open, { storage = pageStorage() } = {}) {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(SHELL_LAYOUT_DRAWER_DEFAULT_OPEN_STORAGE_KEY, open ? "true" : "false");
  } catch {
    // Ignore localStorage write failures in unsupported or locked-down environments.
  }
}

export {
  SHELL_LAYOUT_DRAWER_DEFAULT_OPEN_STORAGE_KEY,
  readDrawerDefaultOpenPreference,
  writeDrawerDefaultOpenPreference
};
