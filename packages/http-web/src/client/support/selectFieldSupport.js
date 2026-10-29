import { useJskitText } from "../i18n.js";

// Display rules for SelectField. Vuetify titles a model value missing from `items` with the raw
// value itself, so a stored id ("53") flashes while options load. Here a missing value shows the last
// title this field saw for it; otherwise it is hidden while `loading` and reads "Unavailable option" once
// the options have settled. The stored value is never changed by display alone.
const { t } = useJskitText();
const unavailableOption = Symbol("unavailable option");

// Mirrors Vuetify's item-title/item-value lookup: a key path, a function, or the primitive item.
function readOption(item, key, fallback) {
  if (typeof key === "function") {
    const value = key(item, fallback);
    return value === undefined ? fallback : value;
  }
  if (item === null || typeof item !== "object" || key == null) {
    return fallback;
  }
  const value = (Array.isArray(key) ? key : String(key).split(".")).reduce((source, part) => source?.[part], item);
  return value === undefined ? fallback : value;
}

function optionTitle(item, itemTitle) {
  return item?.[unavailableOption] ? item.title : readOption(item, itemTitle, item);
}

function optionValue(item, itemTitle, itemValue) {
  return item?.[unavailableOption] ? item.value : readOption(item, itemValue, readOption(item, itemTitle, item));
}

function selectedValues(modelValue, multiple) {
  if (multiple) {
    return modelValue == null ? [] : [].concat(modelValue);
  }
  return modelValue == null || modelValue === "" ? [] : [modelValue];
}

// `seen` (value → item) is the field's memory of titles, so a search that narrows the options
// does not blank a value chosen earlier.
function selectionFieldState(field, seen) {
  const { modelValue, items = [], itemTitle = "title", itemValue = "value", multiple = false, returnObject = false } = field;
  if (returnObject) {
    // The model is the option itself and carries its own title.
    return { modelValue, items, hiddenValues: [] };
  }
  const listed = new Set();
  for (const item of items) {
    const value = optionValue(item, itemTitle, itemValue);
    listed.add(value);
    seen.set(value, item);
  }
  const missing = selectedValues(modelValue, multiple).filter((value) => !listed.has(value));
  const remembered = missing.filter((value) => seen.has(value)).map((value) => seen.get(value));
  const unresolved = missing.filter((value) => !seen.has(value));
  if (field.loading && unresolved.length) {
    return {
      modelValue: multiple ? [].concat(modelValue).filter((value) => !unresolved.includes(value)) : null,
      items: [...items, ...remembered],
      hiddenValues: unresolved
    };
  }
  const title = t("jskit.http.selectField.unavailableOption");
  const unavailable = unresolved.map((value) => ({ [unavailableOption]: true, title, value }));
  return {
    modelValue,
    items: missing.length ? [...items, ...remembered, ...unavailable] : items,
    hiddenValues: []
  };
}

export { optionTitle, optionValue, selectionFieldState };
