import { normalizeText } from "./normalize.js";

const SHELL_OUTLET_TAG_PATTERN = /<ShellOutlet\b([^>]*)\/?>/g;
const ATTRIBUTE_PATTERN = /([:@]?[A-Za-z_][A-Za-z0-9_-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;

function parseTagAttributes(attributesSource = "") {
  const attributes = {};
  const source = String(attributesSource || "");
  for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
    const attributeName = normalizeText(match[1]);
    if (!attributeName) {
      continue;
    }

    const hasValue = match[2] != null || match[3] != null;
    const attributeValue = hasValue ? String(match[2] ?? match[3] ?? "") : true;
    attributes[attributeName] = attributeValue;
  }

  return attributes;
}

function normalizeShellOutletTargetId(value = "") {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return "";
  }

  const separatorIndex = normalizedValue.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= normalizedValue.length - 1) {
    return "";
  }

  const host = normalizeText(normalizedValue.slice(0, separatorIndex));
  const position = normalizeText(normalizedValue.slice(separatorIndex + 1));
  if (!host || !position) {
    return "";
  }

  return `${host}:${position}`;
}

function isDefaultAttributeEnabled(value) {
  if (value === true) {
    return true;
  }

  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return true;
  }

  return normalized !== "false" && normalized !== "0" && normalized !== "no" && normalized !== "off";
}

function discoverShellOutletTargetsFromVueSource(source = "", { context = "shell layout" } = {}) {
  const sourceText = String(source || "");
  const resolvedContext = normalizeText(context) || "shell layout";
  const targetById = new Map();
  let defaultTargetId = "";

  for (const tagMatch of sourceText.matchAll(SHELL_OUTLET_TAG_PATTERN)) {
    const attributes = parseTagAttributes(tagMatch[1]);
    const host = normalizeText(attributes.host);
    const position = normalizeText(attributes.position);
    if (!host || !position) {
      continue;
    }

    const id = normalizeShellOutletTargetId(`${host}:${position}`);
    if (!id) {
      continue;
    }
    if (targetById.has(id)) {
      throw new Error(`${resolvedContext} contains duplicate ShellOutlet target "${id}".`);
    }

    const hasDefaultAttribute = Object.hasOwn(attributes, "default") && isDefaultAttributeEnabled(attributes.default);
    if (hasDefaultAttribute) {
      if (defaultTargetId) {
        throw new Error(
          `${resolvedContext} defines multiple default ShellOutlet targets: "${defaultTargetId}" and "${id}".`
        );
      }
      defaultTargetId = id;
    }

    targetById.set(
      id,
      Object.freeze({
        id,
        host,
        position,
        default: hasDefaultAttribute
      })
    );
  }

  return Object.freeze({
    targets: Object.freeze([...targetById.values()]),
    defaultTargetId
  });
}

export { discoverShellOutletTargetsFromVueSource, normalizeShellOutletTargetId };
