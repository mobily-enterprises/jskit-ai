import { inject, provide } from "vue";

const SETTINGS_CONTEXT_KEY = Symbol("settings-context");

export function provideSettingsContext(value) {
  provide(SETTINGS_CONTEXT_KEY, value);
}

export function useSettingsContext() {
  const context = inject(SETTINGS_CONTEXT_KEY, null);
  if (!context) {
    throw new Error("Settings context is unavailable.");
  }
  return context;
}
