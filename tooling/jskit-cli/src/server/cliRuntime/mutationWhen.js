import { createCliError } from "../shared/cliError.js";
import {
  ensureArray,
  ensureObject
} from "../shared/collectionUtils.js";

function normalizeMutationExtension(value) {
  const extension = String(value || "").trim();
  if (!extension) {
    return "";
  }
  if (extension.startsWith(".")) {
    return extension;
  }
  return `.${extension}`;
}

function normalizeTemplateContextRecord(value) {
  const record = ensureObject(value);
  const entrypoint = String(record.entrypoint || "").trim();
  const exportName = String(record.export || "").trim();
  if (!entrypoint && !exportName) {
    return null;
  }

  return Object.freeze({
    entrypoint,
    export: exportName || "buildTemplateContext"
  });
}

function normalizeFileMutationRecord(value) {
  const record = ensureObject(value);
  const op = String(record.op || "copy-file").trim().toLowerCase() || "copy-file";
  return {
    op,
    from: String(record.from || "").trim(),
    to: String(record.to || "").trim(),
    toSurface: String(record.toSurface || "").trim(),
    toSurfacePath: String(record.toSurfacePath || "").trim(),
    toSurfaceRoot: record.toSurfaceRoot === true,
    toDir: String(record.toDir || "").trim(),
    extension: normalizeMutationExtension(record.extension),
    ownership: String(record.ownership || "").trim().toLowerCase() || "package",
    expectedExistingFrom: String(record.expectedExistingFrom || "").trim(),
    preserveOnRemove: record.preserveOnRemove === true,
    id: String(record.id || "").trim(),
    category: String(record.category || "").trim(),
    reason: String(record.reason || "").trim(),
    templateContext: normalizeTemplateContextRecord(record.templateContext),
    when: normalizeMutationWhen(record.when)
  };
}

function normalizeMutationWhen(value) {
  const source = ensureObject(value);
  const allConditions = ensureArray(source.all)
    .map((entry) => normalizeMutationWhen(entry))
    .filter(Boolean);
  const anyConditions = ensureArray(source.any)
    .map((entry) => normalizeMutationWhen(entry))
    .filter(Boolean);

  const option = String(source.option || "").trim();
  const config = String(source.config || "").trim();
  const equals = String(source.equals || "").trim();
  const notEquals = String(source.notEquals || "").trim();
  const contains = String(source.contains || "").trim();
  const notContains = String(source.notContains || "").trim();
  const includes = ensureArray(source.in).map((entry) => String(entry || "").trim()).filter(Boolean);
  const excludes = ensureArray(source.notIn).map((entry) => String(entry || "").trim()).filter(Boolean);

  if (!option && !config && allConditions.length < 1 && anyConditions.length < 1) {
    return null;
  }

  return {
    all: allConditions,
    any: anyConditions,
    option,
    config,
    equals,
    notEquals,
    contains,
    notContains,
    includes,
    excludes
  };
}

function readObjectPath(source, rawPath) {
  const valueSource = ensureObject(source);
  const fullPath = String(rawPath || "").trim();
  if (!fullPath) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(valueSource, fullPath)) {
    return valueSource[fullPath];
  }

  const segments = fullPath
    .split(".")
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  if (segments.length < 1) {
    return undefined;
  }

  let cursor = valueSource;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
      return undefined;
    }
    if (!Object.prototype.hasOwnProperty.call(cursor, segment)) {
      return undefined;
    }
    cursor = cursor[segment];
  }

  return cursor;
}

function normalizeWhenSourceValue(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value).trim();
  }
  return "";
}

function normalizeWhenComparisonValue(value) {
  const normalizedValue = normalizeWhenSourceValue(value);
  if (!normalizedValue.includes(",")) {
    return normalizedValue;
  }

  return normalizedValue
    .split(",")
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .join(",");
}

function splitWhenComparisonTokens(value) {
  return normalizeWhenComparisonValue(value)
    .split(",")
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function matchesWhenComparisonValue(optionValue, optionTokens, expectedValue) {
  const expected = normalizeWhenComparisonValue(expectedValue);
  if (!expected) {
    return false;
  }

  const expectedTokens = splitWhenComparisonTokens(expected);
  if (expectedTokens.length > 1) {
    return optionValue === expected;
  }

  if (optionTokens.length > 1) {
    return optionTokens.includes(expectedTokens[0]);
  }

  return optionValue === expectedTokens[0];
}

function resolveWhenConfigValue(configContext = {}, configPath = "") {
  const normalizedPath = String(configPath || "").trim();
  if (!normalizedPath) {
    return "";
  }

  const publicConfig = ensureObject(configContext.public);
  const serverConfig = ensureObject(configContext.server);
  const mergedConfig = ensureObject(configContext.merged);
  if (normalizedPath === "public") {
    return publicConfig;
  }
  if (normalizedPath === "server") {
    return serverConfig;
  }
  if (normalizedPath === "merged") {
    return mergedConfig;
  }

  if (normalizedPath.startsWith("public.")) {
    return readObjectPath(publicConfig, normalizedPath.slice("public.".length));
  }
  if (normalizedPath.startsWith("server.")) {
    return readObjectPath(serverConfig, normalizedPath.slice("server.".length));
  }
  if (normalizedPath.startsWith("merged.")) {
    return readObjectPath(mergedConfig, normalizedPath.slice("merged.".length));
  }

  return readObjectPath(mergedConfig, normalizedPath);
}

function shouldApplyMutationWhen(
  when,
  {
    options = {},
    configContext = {},
    packageId = "",
    mutationContext = "mutation"
  } = {}
) {
  if (!when || typeof when !== "object") {
    return true;
  }

  const allConditions = ensureArray(when.all).filter((entry) => entry && typeof entry === "object");
  if (allConditions.length > 0) {
    const allMatch = allConditions.every((entry) =>
      shouldApplyMutationWhen(entry, {
        options,
        configContext,
        packageId,
        mutationContext
      })
    );
    if (!allMatch) {
      return false;
    }
  }

  const anyConditions = ensureArray(when.any).filter((entry) => entry && typeof entry === "object");
  if (anyConditions.length > 0) {
    const anyMatch = anyConditions.some((entry) =>
      shouldApplyMutationWhen(entry, {
        options,
        configContext,
        packageId,
        mutationContext
      })
    );
    if (!anyMatch) {
      return false;
    }
  }

  const optionName = String(when.option || "").trim();
  const configPath = String(when.config || "").trim();
  if (!optionName && !configPath) {
    return true;
  }
  if (optionName && configPath) {
    const packagePrefix = packageId ? `${packageId} ` : "";
    throw createCliError(
      `Invalid ${packagePrefix}${mutationContext}: when cannot declare both "option" and "config".`
    );
  }

  const sourceValue = optionName
    ? readObjectPath(options, optionName)
    : resolveWhenConfigValue(configContext, configPath);
  const optionValue = normalizeWhenComparisonValue(sourceValue);
  const optionTokens = splitWhenComparisonTokens(optionValue);
  const equals = normalizeWhenComparisonValue(when.equals);
  const notEquals = normalizeWhenComparisonValue(when.notEquals);
  const contains = normalizeWhenComparisonValue(when.contains);
  const notContains = normalizeWhenComparisonValue(when.notContains);
  const includes = ensureArray(when.includes).map((entry) => normalizeWhenComparisonValue(entry)).filter(Boolean);
  const excludes = ensureArray(when.excludes).map((entry) => normalizeWhenComparisonValue(entry)).filter(Boolean);

  if (equals && optionValue !== equals) {
    return false;
  }
  if (notEquals && optionValue === notEquals) {
    return false;
  }
  if (contains && !optionValue.includes(contains)) {
    return false;
  }
  if (notContains && optionValue.includes(notContains)) {
    return false;
  }
  if (includes.length > 0 && !includes.some((entry) => matchesWhenComparisonValue(optionValue, optionTokens, entry))) {
    return false;
  }
  if (excludes.length > 0 && excludes.some((entry) => matchesWhenComparisonValue(optionValue, optionTokens, entry))) {
    return false;
  }

  return true;
}

export {
  normalizeMutationExtension,
  normalizeTemplateContextRecord,
  normalizeFileMutationRecord,
  normalizeMutationWhen,
  readObjectPath,
  normalizeWhenSourceValue,
  resolveWhenConfigValue,
  shouldApplyMutationWhen
};
