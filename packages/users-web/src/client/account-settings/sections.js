import { inject } from "vue";

const ACCOUNT_SETTINGS_SECTIONS_INJECTION_KEY = Symbol("users-web.account-settings.sections");
const ACCOUNT_SETTINGS_SECTION_REGISTRY_TAG = "users.web.account-settings.sections";
const EMPTY_ACCOUNT_SETTINGS_SECTIONS = Object.freeze([]);
const RESERVED_ACCOUNT_SETTINGS_SECTION_VALUES = Object.freeze([
  "profile",
  "preferences",
  "notifications"
]);

function normalizeAccountSettingsSectionEntry(entry = null) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const value = String(entry.value || "").trim().toLowerCase();
  const title = String(entry.title || "").trim();
  const component = entry.component;
  if (!value || !title || !component) {
    return null;
  }

  return Object.freeze({
    value,
    title,
    component,
    order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : 500,
    usesSharedRuntime: entry.usesSharedRuntime === true
  });
}

function sortAccountSettingsSections(entries = []) {
  return Object.freeze(
    [...entries].sort((left, right) => {
      const orderDelta = left.order - right.order;
      if (orderDelta !== 0) {
        return orderDelta;
      }
      return left.value.localeCompare(right.value);
    })
  );
}

function resolveAccountSettingsSections(entries = []) {
  const seen = new Set(RESERVED_ACCOUNT_SETTINGS_SECTION_VALUES);
  const normalized = [];

  for (const entry of Array.isArray(entries) ? entries : []) {
    const resolved = normalizeAccountSettingsSectionEntry(entry);
    if (!resolved || seen.has(resolved.value)) {
      continue;
    }
    seen.add(resolved.value);
    normalized.push(resolved);
  }

  return sortAccountSettingsSections(normalized);
}

function useAccountSettingsSections() {
  return inject(ACCOUNT_SETTINGS_SECTIONS_INJECTION_KEY, EMPTY_ACCOUNT_SETTINGS_SECTIONS);
}

export {
  ACCOUNT_SETTINGS_SECTIONS_INJECTION_KEY,
  ACCOUNT_SETTINGS_SECTION_REGISTRY_TAG,
  EMPTY_ACCOUNT_SETTINGS_SECTIONS,
  RESERVED_ACCOUNT_SETTINGS_SECTION_VALUES,
  normalizeAccountSettingsSectionEntry,
  resolveAccountSettingsSections,
  sortAccountSettingsSections,
  useAccountSettingsSections
};
