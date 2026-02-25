function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  const entries = Array.isArray(value) ? value : Object.values(value);
  for (const entry of entries) {
    deepFreeze(entry);
  }

  return Object.freeze(value);
}

function expectBoolean(name, value) {
  if (typeof value !== "boolean") {
    throw new Error(`config.${name} must be a boolean.`);
  }
}

function expectPositiveInteger(name, value, { min = 1 } = {}) {
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`config.${name} must be an integer >= ${min}.`);
  }
}

function expectNumber(name, value, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`config.${name} must be a finite number between ${min} and ${max}.`);
  }
}

function expectString(name, value, { allowEmpty = false } = {}) {
  if (typeof value !== "string") {
    throw new Error(`config.${name} must be a string.`);
  }
  if (!allowEmpty && !value.trim()) {
    throw new Error(`config.${name} must be a non-empty string.`);
  }
}

function expectOneOf(name, value, allowedValues) {
  if (!allowedValues.includes(value)) {
    throw new Error(`config.${name} must be one of: ${allowedValues.join(", ")}.`);
  }
}

function expectPlainObject(name, value) {
  if (!isPlainObject(value)) {
    throw new Error(`config.${name} must be an object.`);
  }
}

export { deepFreeze, expectBoolean, expectPositiveInteger, expectNumber, expectString, expectOneOf, expectPlainObject };
