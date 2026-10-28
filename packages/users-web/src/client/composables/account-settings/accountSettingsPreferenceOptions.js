import { getClientAppConfig } from "@jskit-ai/kernel/client";
import { normalizeLocaleCode } from "@jskit-ai/users-core/shared/settings";
import { useJskitText } from "../../i18n.js";
import { LOCALE_OPTIONS } from "./accountSettingsRuntimeConstants.js";

function translateOptions(options = []) {
  const { t } = useJskitText();
  return options.map(({ titleKey, value }) => ({ title: t(titleKey), value }));
}

function languageName(code) {
  try {
    return new Intl.DisplayNames(useJskitText().locale, { type: "language" }).of(code) || code;
  } catch {
    return code;
  }
}

// The app's languages (config.languages = [{ code, name }]); the name may also be a
// message key. Without them, JSKIT's default list.
function resolveLanguageOptions(appConfig = getClientAppConfig()) {
  const { text } = useJskitText();
  const options = [];
  for (const language of Array.isArray(appConfig?.languages) ? appConfig.languages : []) {
    const value = normalizeLocaleCode(language?.code);
    if (value && !options.some((option) => option.value === value)) {
      options.push({ title: text(language.name) || languageName(value), value });
    }
  }
  return options.length > 0 ? options : translateOptions(LOCALE_OPTIONS);
}

// A saved locale the list does not offer (the server default "en", or a language
// the app no longer configures) stays selectable under its language name.
function resolveLocaleOptions(savedLocale = "", appConfig = getClientAppConfig()) {
  const options = resolveLanguageOptions(appConfig);
  const saved = normalizeLocaleCode(savedLocale);
  if (!saved || options.some((option) => option.value === saved)) {
    return options;
  }
  return [...options, { title: languageName(saved), value: saved }];
}

export {
  resolveLanguageOptions,
  resolveLocaleOptions,
  translateOptions
};
