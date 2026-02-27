import { createCliError, ensureObject, ensureRecord, ensurePackId, ensurePackageId } from "./validationHelpers.mjs";

function normalizeOptionValues(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => value.length > 0);
}

export function normalizePackDescriptor(pack, descriptorPath) {
  ensureObject(pack, `Pack descriptor at ${descriptorPath}`);

  if (Number(pack.packVersion) !== 2) {
    throw createCliError(`Pack descriptor ${descriptorPath} must set packVersion to 2.`);
  }

  const packId = ensurePackId(pack.packId, `Pack descriptor ${descriptorPath} packId`);
  const version = String(pack.version || "").trim();
  if (!version) {
    throw createCliError(`Pack descriptor ${descriptorPath} must define version.`);
  }

  const optionsSource = ensureRecord(pack.options, `Pack ${packId} options`);
  const options = {};

  for (const [optionName, optionValue] of Object.entries(optionsSource)) {
    const normalizedOptionName = String(optionName || "").trim();
    if (!/^[a-z][a-z0-9-]*$/.test(normalizedOptionName)) {
      throw createCliError(`Pack ${packId} has invalid option name: ${optionName}`);
    }

    const option = ensureObject(optionValue, `Pack ${packId} option ${normalizedOptionName}`);
    const values = normalizeOptionValues(option.values);

    options[normalizedOptionName] = {
      required: Boolean(option.required),
      values
    };
  }

  const packages = (Array.isArray(pack.packages) ? pack.packages : []).map((entry, index) => {
    if (typeof entry === "string") {
      return {
        packageId: ensurePackageId(entry, `Pack ${packId} packages[${index}]`),
        when: null
      };
    }

    ensureObject(entry, `Pack ${packId} packages[${index}]`);
    const packageId = ensurePackageId(entry.packageId, `Pack ${packId} packages[${index}].packageId`);

    let when = null;
    if (entry.when) {
      const whenSource = ensureObject(entry.when, `Pack ${packId} packages[${index}].when`);
      const option = String(whenSource.option || "").trim();
      const equals = String(whenSource.equals || "").trim();
      if (!option || !equals) {
        throw createCliError(
          `Pack ${packId} packages[${index}].when must define option and equals.`
        );
      }
      if (!options[option]) {
        throw createCliError(`Pack ${packId} packages[${index}].when references unknown option: ${option}`);
      }
      const allowedValues = options[option].values;
      if (allowedValues.length > 0 && !allowedValues.includes(equals)) {
        throw createCliError(
          `Pack ${packId} packages[${index}].when equals value ${equals} is not allowed for option ${option}.`
        );
      }
      when = {
        option,
        equals
      };
    }

    return {
      packageId,
      when
    };
  });

  if (packages.length < 1) {
    throw createCliError(`Pack descriptor ${descriptorPath} must define at least one package mapping.`);
  }

  return {
    packVersion: 2,
    packId,
    version,
    description: String(pack.description || "").trim(),
    options,
    packages
  };
}
