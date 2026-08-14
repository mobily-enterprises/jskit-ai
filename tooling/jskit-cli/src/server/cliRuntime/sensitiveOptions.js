import path from "node:path";
import process from "node:process";
import {
  ensureArray,
  ensureObject
} from "../shared/collectionUtils.js";
import {
  escapeRegExp,
  interpolateOptionValue,
  isSecretOptionInput
} from "../shared/optionInterpolation.js";
import { parseEnvLineValue } from "./appState.js";

const OPTION_REFERENCE_PATTERN = /\$\{option:([a-z][a-z0-9-]*)(\|[^}]*)?\}/gi;
const SENSITIVE_NAME_PATTERN = /(^|[-_])(password|passwd|passphrase|secret|token|api[-_]?key|private[-_]?key|credential|credentials)([-_]|$)/i;

function collectOptionReferences(value = "") {
  return [...new Set(
    [...String(value || "").matchAll(OPTION_REFERENCE_PATTERN)]
      .map((match) => String(match[1] || "").trim())
      .filter(Boolean)
  )];
}

function isSensitiveName(value = "") {
  return SENSITIVE_NAME_PATTERN.test(String(value || "").trim());
}

function isSensitivePackageOption(packageEntry = {}, optionName = "") {
  const normalizedOptionName = String(optionName || "").trim();
  if (!normalizedOptionName) {
    return false;
  }
  const optionSchema = ensureObject(ensureObject(packageEntry?.packageMetadata?.options)[normalizedOptionName]);
  return isSecretOptionInput(optionSchema) || isSensitiveName(normalizedOptionName);
}

function isSensitiveEnvKey(key = "") {
  return isSensitiveName(String(key || "").trim().toLowerCase().replace(/_/g, "-"));
}

function textValueReferencesSensitiveOption(packageEntry = {}, value = "") {
  return collectOptionReferences(value).some((optionName) =>
    isSensitivePackageOption(packageEntry, optionName)
  );
}

function isExactOptionReference(value = "", optionName = "") {
  const pattern = new RegExp(`^\\s*\\$\\{option:${escapeRegExp(optionName)}\\}\\s*$`, "i");
  return pattern.test(String(value || ""));
}

function isSensitiveTextMutation({ packageEntry = {}, mutation = {}, resolvedKey = "" } = {}) {
  const mutationRecord = ensureObject(mutation);
  return mutationRecord.sensitive === true ||
    mutationRecord.secret === true ||
    (String(mutationRecord.op || "").trim() === "upsert-env" && isSensitiveEnvKey(resolvedKey)) ||
    textValueReferencesSensitiveOption(packageEntry, mutationRecord.value);
}

function readEnvValue(content = "", key = "") {
  const lookupPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
  for (const line of String(content || "").split(/\r?\n/)) {
    if (lookupPattern.test(line)) {
      return String(parseEnvLineValue(line, key) || "");
    }
  }
  return null;
}

async function resolveOptionEnvFallbacks({
  packageEntry = {},
  appRoot = "",
  optionInput = {},
  readFileBufferIfExists,
  environment = process.env
} = {}) {
  if (!appRoot || typeof readFileBufferIfExists !== "function") {
    return {};
  }

  const fallbacks = {};
  const runtimeEnvironment = ensureObject(environment);
  const runtimeOptions = ensureObject(optionInput);
  const optionSchemas = ensureObject(packageEntry?.packageMetadata?.options);
  const textMutations = ensureArray(ensureObject(packageEntry?.packageMetadata?.mutations).text);

  for (const mutation of textMutations) {
    const mutationRecord = ensureObject(mutation);
    if (String(mutationRecord.op || "").trim() !== "upsert-env") {
      continue;
    }
    const relativeFile = String(mutationRecord.file || "").trim();
    const rawKey = String(mutationRecord.key || "").trim();
    if (!relativeFile || !rawKey) {
      continue;
    }
    const referencedOptionNames = collectOptionReferences(mutationRecord.value)
      .filter((optionName) => !Object.prototype.hasOwnProperty.call(runtimeOptions, optionName));
    if (referencedOptionNames.length !== 1) {
      continue;
    }
    const optionName = referencedOptionNames[0];
    if (!isExactOptionReference(mutationRecord.value, optionName)) {
      continue;
    }

    let resolvedKey = "";
    try {
      resolvedKey = interpolateOptionValue(
        rawKey,
        runtimeOptions,
        packageEntry.packageId,
        `${rawKey}.key`
      ).trim();
    } catch {
      continue;
    }
    if (!resolvedKey) {
      continue;
    }

    const optionSchema = ensureObject(optionSchemas[optionName]);
    const environmentValue = Object.prototype.hasOwnProperty.call(runtimeEnvironment, resolvedKey)
      ? String(runtimeEnvironment[resolvedKey] ?? "")
      : null;
    if (environmentValue !== null && (environmentValue || optionSchema.allowEmpty === true)) {
      fallbacks[optionName] = environmentValue;
      continue;
    }

    const existing = await readFileBufferIfExists(path.join(appRoot, relativeFile));
    if (!existing.exists) {
      continue;
    }
    const envValue = readEnvValue(existing.buffer.toString("utf8"), resolvedKey);
    if (envValue !== null && (envValue || optionSchema.allowEmpty === true)) {
      fallbacks[optionName] = envValue;
    }
  }
  return fallbacks;
}

export {
  collectOptionReferences,
  isSensitiveEnvKey,
  isSensitivePackageOption,
  isSensitiveTextMutation,
  resolveOptionEnvFallbacks
};
