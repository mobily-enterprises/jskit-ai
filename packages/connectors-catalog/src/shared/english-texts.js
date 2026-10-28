import { catalogMessage, formatMessage } from "@jskit-ai/kernel/shared/i18n";
import { MESSAGE_KEY_SOURCE } from "@jskit-ai/connectors-core/shared/configuration";
import en from "../../locales/en.json" with { type: "json" };

// Catalog definitions carry message keys, which connectors-web translates. Code that
// shows a definition's texts itself gets the same definitions with every key (and every
// { key, params } a function returns) rendered to its English, exactly as before keys.
// Each English object keeps its keyed original under MESSAGE_KEY_SOURCE.
const rendered = new WeakMap();

function englishMessage(key, params) {
  const message = typeof key === "string" ? catalogMessage(en, key) : undefined;
  return message === undefined ? undefined : formatMessage(message, params);
}

function englishTexts(value) {
  if (typeof value === "string") {
    return englishMessage(value) ?? value;
  }
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return value;
  }
  if (rendered.has(value)) {
    return rendered.get(value);
  }
  let english = value;
  if (typeof value === "function") {
    english = function (...args) { return englishTexts(value.apply(this, args)); };
  } else if (Array.isArray(value)) {
    english = value.map((item) => englishTexts(item));
  } else if (Object.getPrototypeOf(value) === Object.prototype) {
    const message = englishMessage(value.key, value.params);
    if (message !== undefined) {
      return message;
    }
    english = Object.fromEntries(Object.entries(value).map(([name, inner]) => [name, englishTexts(inner)]));
    Object.defineProperty(english, MESSAGE_KEY_SOURCE, { value });
  }
  if (english !== value && Object.isFrozen(value)) {
    Object.freeze(english);
  }
  rendered.set(value, english);
  return english;
}

export { englishTexts };
