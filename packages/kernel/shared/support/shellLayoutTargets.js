import {
  normalizeObject,
  normalizeText
} from "./normalize.js";

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

function resolveShellOutletTargetParts(
  {
    target = ""
  } = {}
) {
  const normalizedTargetId = normalizeShellOutletTargetId(target);
  if (!normalizedTargetId) {
    return null;
  }

  return Object.freeze({
    id: normalizedTargetId
  });
}

function findShellOutletTargetById(targets = [], targetId = "") {
  const entries = Array.isArray(targets) ? targets : [];
  const normalizedTargetId = normalizeShellOutletTargetId(targetId);
  if (!normalizedTargetId) {
    return null;
  }

  return entries.find((entry) => normalizeShellOutletTargetId(entry?.id) === normalizedTargetId) || null;
}

function describeShellOutletTargets(targets = []) {
  return (Array.isArray(targets) ? targets : [])
    .map((entry) => normalizeShellOutletTargetId(entry?.id))
    .filter(Boolean)
    .join(", ");
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

function normalizeShellOutletTargetRecord(
  value = {},
  {
    context = "shell layout"
  } = {}
) {
  const record = normalizeObject(value);
  const resolvedContext = normalizeText(context) || "shell layout";
  if (Object.hasOwn(record, "host") || Object.hasOwn(record, "position")) {
    throw new Error(
      `${resolvedContext} must declare ShellOutlet targets with "target" only. ` +
      `Legacy "host" and "position" attributes are not supported.`
    );
  }

  const targetParts = resolveShellOutletTargetParts(
    {
      target: record.target
    },
    { context: resolvedContext }
  );
  if (!targetParts) {
    return null;
  }

  return Object.freeze({
    ...targetParts,
    default:
      Object.hasOwn(record, "default") &&
      isDefaultAttributeEnabled(record.default),
    defaultLinkComponentToken:
      normalizeText(record.defaultLinkComponentToken) ||
      normalizeText(record["default-link-component-token"])
  });
}

function discoverShellOutletTargetsFromVueSource(source = "", { context = "shell layout" } = {}) {
  const sourceText = String(source || "");
  const resolvedContext = normalizeText(context) || "shell layout";
  const targetById = new Map();
  let defaultTargetId = "";

  for (const tagMatch of sourceText.matchAll(SHELL_OUTLET_TAG_PATTERN)) {
    const attributes = parseTagAttributes(tagMatch[1]);
    const normalizedTarget = normalizeShellOutletTargetRecord(attributes, {
      context: resolvedContext
    });
    if (!normalizedTarget) {
      continue;
    }
    if (targetById.has(normalizedTarget.id)) {
      throw new Error(`${resolvedContext} contains duplicate ShellOutlet target "${normalizedTarget.id}".`);
    }

    if (normalizedTarget.default) {
      if (defaultTargetId) {
        throw new Error(
          `${resolvedContext} defines multiple default ShellOutlet targets: "${defaultTargetId}" and "${normalizedTarget.id}".`
        );
      }
      defaultTargetId = normalizedTarget.id;
    }

    targetById.set(normalizedTarget.id, normalizedTarget);
  }

  return Object.freeze({
    targets: Object.freeze([...targetById.values()]),
    defaultTargetId
  });
}

export {
  describeShellOutletTargets,
  discoverShellOutletTargetsFromVueSource,
  findShellOutletTargetById,
  normalizeShellOutletTargetId,
  normalizeShellOutletTargetRecord,
  resolveShellOutletTargetParts
};
