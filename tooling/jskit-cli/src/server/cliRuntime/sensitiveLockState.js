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
  return [
    ...new Set(
      [...String(value || "").matchAll(OPTION_REFERENCE_PATTERN)]
        .map((match) => String(match[1] || "").trim())
        .filter(Boolean)
    )
  ];
}

function isSensitiveName(value = "") {
  return SENSITIVE_NAME_PATTERN.test(String(value || "").trim());
}

function isSensitivePackageOption(packageEntry = {}, optionName = "") {
  const normalizedOptionName = String(optionName || "").trim();
  if (!normalizedOptionName) {
    return false;
  }

  const optionSchemas = ensureObject(packageEntry?.descriptor?.options);
  const optionSchema = ensureObject(optionSchemas[normalizedOptionName]);
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
  if (mutationRecord.sensitive === true || mutationRecord.secret === true) {
    return true;
  }
  if (String(mutationRecord.op || "").trim() === "upsert-env" && isSensitiveEnvKey(resolvedKey)) {
    return true;
  }
  return textValueReferencesSensitiveOption(packageEntry, mutationRecord.value);
}

function isSensitiveManagedTextRecord({ packageEntry = {}, record = {} } = {}) {
  const changeRecord = ensureObject(record);
  if (changeRecord.sensitive === true || changeRecord.secret === true) {
    return true;
  }
  if (String(changeRecord.op || "").trim() === "upsert-env" && isSensitiveEnvKey(changeRecord.key)) {
    return true;
  }
  return textValueReferencesSensitiveOption(packageEntry, changeRecord.value);
}

function sanitizePackageOptionsForLock(packageEntry = {}, options = {}) {
  const sanitized = {};
  for (const [optionName, optionValue] of Object.entries(ensureObject(options))) {
    if (isSensitivePackageOption(packageEntry, optionName)) {
      continue;
    }
    sanitized[optionName] = optionValue;
  }
  return sanitized;
}

function sanitizePackageOptionsForResolve(packageEntry = {}, options = {}) {
  return sanitizePackageOptionsForLock(packageEntry, options);
}

function sanitizeManagedTextForLock(packageEntry = {}, managedText = {}) {
  const sanitized = {};
  for (const [recordKey, rawRecord] of Object.entries(ensureObject(managedText))) {
    const record = {
      ...ensureObject(rawRecord)
    };
    if (isSensitiveManagedTextRecord({ packageEntry, record })) {
      delete record.value;
      delete record.previousValue;
      record.sensitive = true;
    }
    sanitized[recordKey] = record;
  }
  return sanitized;
}

function sanitizeInstalledPackageRecordForLock(record = {}, packageEntry = {}) {
  const installedRecord = ensureObject(record);
  const managed = ensureObject(installedRecord.managed);
  const sanitizedRecord = {
    ...installedRecord,
    options: sanitizePackageOptionsForLock(packageEntry, installedRecord.options)
  };

  if (Object.keys(managed).length > 0) {
    sanitizedRecord.managed = {
      ...managed,
      text: sanitizeManagedTextForLock(packageEntry, managed.text)
    };
  }

  return sanitizedRecord;
}

function sanitizeLockSecretsForWrite(lock = {}, packageRegistry = null) {
  const lockRecord = ensureObject(lock);
  const installedPackages = ensureObject(lockRecord.installedPackages);
  for (const [packageId, installedRecord] of Object.entries(installedPackages)) {
    const packageEntry = packageRegistry?.get?.(packageId) || {
      packageId,
      descriptor: {
        options: {}
      }
    };
    installedPackages[packageId] = sanitizeInstalledPackageRecordForLock(installedRecord, packageEntry);
  }
  lockRecord.installedPackages = installedPackages;
  return lockRecord;
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

async function resolveSensitiveOptionEnvFallbacks({
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
  const optionSchemas = ensureObject(packageEntry?.descriptor?.options);
  const textMutations = ensureArray(ensureObject(packageEntry?.descriptor?.mutations).text);

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

    const sensitiveOptionNames = collectOptionReferences(mutationRecord.value)
      .filter((optionName) => isSensitivePackageOption(packageEntry, optionName))
      .filter((optionName) => !Object.prototype.hasOwnProperty.call(runtimeOptions, optionName));
    if (sensitiveOptionNames.length !== 1) {
      continue;
    }

    const optionName = sensitiveOptionNames[0];
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
  isSensitiveManagedTextRecord,
  isSensitivePackageOption,
  isSensitiveTextMutation,
  resolveSensitiveOptionEnvFallbacks,
  sanitizeInstalledPackageRecordForLock,
  sanitizeLockSecretsForWrite,
  sanitizeManagedTextForLock,
  sanitizePackageOptionsForLock,
  sanitizePackageOptionsForResolve
};
