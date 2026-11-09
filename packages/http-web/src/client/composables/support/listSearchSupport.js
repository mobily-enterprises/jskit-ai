import {
  normalizeInteger,
  normalizeText
} from "@jskit-ai/kernel/shared/support/normalize";
import { asPlainObject } from "./scopeHelpers.js";
import { useJskitText } from "../../i18n.js";

const { t, text } = useJskitText();

const DEFAULT_LIST_SEARCH_DEBOUNCE_MS = 250;
const DEFAULT_LIST_SEARCH_MIN_LENGTH = 1;
const LIST_SEARCH_MODE_QUERY = "query";

// A list holds the page it loaded, so a search runs on the server: it sends the typed text as `queryParam` (q), and the
// resource's searchSchema.q searches every row. No mode searches the loaded page in the browser.
function normalizeListSearchConfig(value = {}) {
  const source = asPlainObject(value);
  const mode = normalizeText(source.mode).toLowerCase() || LIST_SEARCH_MODE_QUERY;
  if (mode !== LIST_SEARCH_MODE_QUERY) {
    throw new TypeError(
      `List search runs on the server and takes no mode "${mode}": drop the mode, and give the resource searchSchema.q, ` +
      "which the list's search sends as q. A search of the loaded page misses every row past it."
    );
  }
  if (Object.hasOwn(source, "fields")) {
    throw new TypeError(
      "List search takes no fields: the resource's searchSchema.q names the fields a search reads, on the server."
    );
  }

  return Object.freeze({
    enabled: source.enabled === true,
    mode,
    queryParam: normalizeText(source.queryParam) || "q",
    label: normalizeText(text(source.label)) || t("jskit.http.list.search"),
    placeholder: normalizeText(source.placeholder),
    initialQuery: normalizeText(source.initialQuery),
    debounceMs: normalizeInteger(source.debounceMs, {
      fallback: DEFAULT_LIST_SEARCH_DEBOUNCE_MS,
      min: 0
    }),
    minLength: normalizeInteger(source.minLength, {
      fallback: DEFAULT_LIST_SEARCH_MIN_LENGTH,
      min: DEFAULT_LIST_SEARCH_MIN_LENGTH
    })
  });
}

export {
  normalizeListSearchConfig
};
