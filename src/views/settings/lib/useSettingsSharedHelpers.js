import { SETTINGS_SECTION_QUERY_KEY, VALID_SETTINGS_TABS } from "./useSettingsPageConfig";

export function clearFieldErrors(target) {
  for (const key of Object.keys(target)) {
    target[key] = "";
  }
}

export function toErrorMessage(error, fallback) {
  if (error?.fieldErrors && typeof error.fieldErrors === "object") {
    const details = Array.from(
      new Set(
        Object.values(error.fieldErrors)
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      )
    );

    if (details.length > 0) {
      return details.join(" ");
    }
  }

  return String(error?.message || fallback);
}

export function resolveTabFromSearch(search) {
  const tab = String(search?.[SETTINGS_SECTION_QUERY_KEY] || "")
    .trim()
    .toLowerCase();

  return VALID_SETTINGS_TABS.has(tab) ? tab : "profile";
}
