// JSKIT message catalogs are nested JSON under "jskit.<namespace>", written in the
// vue-i18n message syntax subset below so the same English text renders through an
// app's vue-i18n instance, without one, and on the server (emails, error messages).
// Supported: named {placeholders}, literal {'text'} and plural choices split by |.

const MESSAGE_KEY_PREFIX = "jskit.";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// A dotted server code ("auth.login.invalidCredentials") renders from
// "jskit.auth.login.invalidCredentials". Older undotted codes kept for existing
// callers ("ACTION_PERMISSION_DENIED", "not_found") render from "jskit.errors.<code>".
function messageKeyForCode(code = "") {
  const normalized = String(code || "").trim();
  if (!normalized) {
    return "";
  }
  return normalized.includes(".") ? `${MESSAGE_KEY_PREFIX}${normalized}` : `${MESSAGE_KEY_PREFIX}errors.${normalized}`;
}

function catalogMessage(catalog, key = "") {
  let current = catalog;
  for (const segment of String(key || "").split(".")) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return typeof current === "string" ? current : undefined;
}

// Later catalogs win, so an application's own messages override JSKIT's English.
function mergeCatalogs(...catalogs) {
  const merged = {};
  for (const catalog of catalogs) {
    if (!isRecord(catalog)) {
      continue;
    }
    for (const [name, value] of Object.entries(catalog)) {
      merged[name] = isRecord(value) && isRecord(merged[name]) ? mergeCatalogs(merged[name], value) : value;
    }
  }
  return merged;
}

function flattenCatalog(catalog, prefix = "") {
  const flat = {};
  if (!isRecord(catalog)) {
    return flat;
  }
  for (const [name, value] of Object.entries(catalog)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (isRecord(value)) {
      Object.assign(flat, flattenCatalog(value, key));
    } else {
      flat[key] = value;
    }
  }
  return flat;
}

function placeholderEnd(template, start) {
  let index = start + 1;
  let quoted = false;
  while (index < template.length) {
    const char = template[index];
    if (char === "'") {
      quoted = !quoted;
    } else if (char === "}" && !quoted) {
      return index;
    }
    index += 1;
  }
  throw new SyntaxError(`Unclosed placeholder in message: ${template}`);
}

function parseMessage(template = "") {
  const source = String(template);
  const choices = [[]];
  let text = "";
  const flush = () => {
    if (text) {
      choices.at(-1).push({ text });
      text = "";
    }
  };
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === "{") {
      const end = placeholderEnd(source, index);
      const body = source.slice(index + 1, end).trim();
      flush();
      choices.at(-1).push(body.startsWith("'") ? { text: body.slice(1, -1) } : { param: body });
      index = end + 1;
      continue;
    }
    if (char === "|") {
      flush();
      choices.push([]);
      index += 1;
      continue;
    }
    text += char;
    index += 1;
  }
  flush();
  if (choices.length > 1) {
    for (const parts of choices) {
      if (parts[0]?.text !== undefined) parts[0] = { text: parts[0].text.trimStart() };
      const last = parts.length - 1;
      if (parts[last]?.text !== undefined) parts[last] = { text: parts[last].text.trimEnd() };
    }
  }
  return choices;
}

// vue-i18n's default plural rule: two choices are "one | other", three are
// "zero | one | other".
function pluralChoice(count, choices) {
  const value = Math.abs(Number(count));
  if (choices === 2) {
    return value ? (value > 1 ? 1 : 0) : 1;
  }
  return value ? Math.min(value, 2) : 0;
}

function formatMessage(template = "", params = {}) {
  const values = isRecord(params) ? params : {};
  const choices = parseMessage(template);
  const count = values.count ?? values.n;
  const index = choices.length > 1 && Number.isFinite(Number(count))
    ? Math.min(pluralChoice(count, choices.length), choices.length - 1)
    : 0;
  return choices[index]
    .map((part) => (part.param === undefined ? part.text : String(values[part.param] ?? "")))
    .join("");
}

function messageParams(template = "") {
  const names = new Set();
  for (const parts of parseMessage(template)) {
    for (const part of parts) {
      if (part.param !== undefined) names.add(part.param);
    }
  }
  return [...names].sort();
}

export {
  catalogMessage,
  flattenCatalog,
  formatMessage,
  mergeCatalogs,
  messageKeyForCode,
  messageParams
};
