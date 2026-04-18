import {
  ACCOUNT_SETTINGS_SECTIONS_INJECTION_KEY,
  ACCOUNT_SETTINGS_SECTION_REGISTRY_TAG,
  resolveAccountSettingsSections
} from "../account-settings/sections.js";

async function bootUsersWebClientProvider(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("bootUsersWebClientProvider requires application make().");
  }

  const vueApp = app.make("jskit.client.vue.app");
  if (!vueApp || typeof vueApp.provide !== "function") {
    throw new Error("bootUsersWebClientProvider requires jskit.client.vue.app provide().");
  }

  const extensionSections =
    typeof app.resolveTag === "function"
      ? app.resolveTag(ACCOUNT_SETTINGS_SECTION_REGISTRY_TAG)
      : [];

  vueApp.provide(
    ACCOUNT_SETTINGS_SECTIONS_INJECTION_KEY,
    resolveAccountSettingsSections(extensionSections)
  );
}

export { bootUsersWebClientProvider };
