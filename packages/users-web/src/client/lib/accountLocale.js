import { readonly, ref } from "vue";
import { normalizeLocaleCode } from "@jskit-ai/users-core/shared/settings";

// The signed-in user's saved language (user_settings.locale) as a canonical BCP 47
// code, or "" when nobody is signed in. JSKIT never switches the app's vue-i18n
// locale; the app watches this and switches it.
const accountLocale = ref("");
const readonlyAccountLocale = readonly(accountLocale);

function setAccountLocale(value) {
  accountLocale.value = normalizeLocaleCode(value);
}

function resolveBootstrapAccountLocale(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  if (source.session?.authenticated !== true) {
    return "";
  }
  return normalizeLocaleCode(source.userSettings?.locale);
}

function useAccountLocale() {
  return readonlyAccountLocale;
}

export {
  resolveBootstrapAccountLocale,
  setAccountLocale,
  useAccountLocale
};
