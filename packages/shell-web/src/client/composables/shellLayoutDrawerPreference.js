const SHELL_LAYOUT_DRAWER_DEFAULT_OPEN_STORAGE_KEY = "jskit.shell-web.drawer-default-open";

function readDrawerDefaultOpenPreference({
  storage = typeof window === "object" ? window?.localStorage : null
} = {}) {
  if (!storage || typeof storage.getItem !== "function") {
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

function writeDrawerDefaultOpenPreference(open, {
  storage = typeof window === "object" ? window?.localStorage : null
} = {}) {
  if (!storage || typeof storage.setItem !== "function") {
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
