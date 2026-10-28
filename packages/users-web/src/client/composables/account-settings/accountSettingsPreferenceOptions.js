import { getClientAppConfig } from "@jskit-ai/kernel/client";
import { normalizeLocaleCode } from "@jskit-ai/users-core/shared/settings";
import { useJskitText } from "../../i18n.js";
import { LOCALE_OPTIONS } from "./accountSettingsRuntimeConstants.js";

function translateOptions(options = []) {
  const { t } = useJskitText();
  return options.map(({ titleKey, value }) => ({ title: t(titleKey), value }));
}

// Language names in the app's language; an app without one is English.
function languageName(code) {
  try {
    return new Intl.DisplayNames(useJskitText().locale || "en", { type: "language" }).of(code) || code;
  } catch {
    return code;
  }
}

function configuredLanguageOptions(appConfig) {
  const { text } = useJskitText();
  const options = [];
  for (const language of Array.isArray(appConfig?.languages) ? appConfig.languages : []) {
    const value = normalizeLocaleCode(language?.code);
    if (value && !options.some((option) => option.value === value)) {
      options.push({ title: text(language.name) || languageName(value), value });
    }
  }
  return options;
}

// The app's languages (config.languages = [{ code, name }]); the name may also be a
// message key. Without them, JSKIT's default list.
function resolveLanguageOptions(appConfig = getClientAppConfig()) {
  const options = configuredLanguageOptions(appConfig);
  return options.length > 0 ? options : translateOptions(LOCALE_OPTIONS);
}

// With configured languages, a saved locale the list does not offer (the server
// default "en", or a language the app no longer configures) stays selectable under
// its language name. JSKIT's default list stays exactly as it is.
function resolveLocaleOptions(savedLocale = "", appConfig = getClientAppConfig()) {
  const options = resolveLanguageOptions(appConfig);
  const saved = normalizeLocaleCode(savedLocale);
  if (!saved || !configuredLanguageOptions(appConfig).length || options.some((option) => option.value === saved)) {
    return options;
  }
  return [...options, { title: languageName(saved), value: saved }];
}

export {
  resolveLanguageOptions,
  resolveLocaleOptions,
  translateOptions
};
