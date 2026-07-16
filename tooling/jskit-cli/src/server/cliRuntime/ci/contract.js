import { createCliError } from "../../shared/cliError.js";

const CI_STEP_PHASE_BEFORE_VERIFY = "before-verify";
const CI_STEP_PHASES = Object.freeze([
  CI_STEP_PHASE_BEFORE_VERIFY
]);
const CI_ID_PATTERN = /^[a-z][a-z0-9-]*$/u;
const CI_SERVICE_ID_PATTERN = /^[a-z][a-z0-9_-]*$/u;
const RESERVED_CI_STEP_IDS = new Set([
  "checkout",
  "install-dependencies",
  "setup-node",
  "verify"
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidCiContract(message, { descriptorPath = "", packageId = "" } = {}) {
  const location = String(descriptorPath || packageId || "package descriptor").trim();
  return createCliError(`Invalid package descriptor at ${location}: ${message}`);
}

function requirePlainObject(value, label, context) {
  if (!isPlainObject(value)) {
    throw invalidCiContract(`${label} must be an object.`, context);
  }
  return value;
}

function rejectUnknownKeys(value, allowedKeys, label, context) {
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) {
    throw invalidCiContract(
      `${label} contains unsupported field${unknownKeys.length === 1 ? "" : "s"}: ${unknownKeys.sort().join(", ")}.`,
      context
    );
  }
}

function normalizeCiScalar(value, label, context) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  throw invalidCiContract(`${label} must be a string, boolean, or finite number.`, context);
}

function normalizeCiEnvironment(value, label, context) {
  if (typeof value === "undefined") {
    return {};
  }
  const environment = requirePlainObject(value, label, context);
  const normalized = {};
  for (const key of Object.keys(environment).sort((left, right) => left.localeCompare(right))) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) {
      throw invalidCiContract(`${label} contains an empty key.`, context);
    }
    normalized[normalizedKey] = normalizeCiScalar(
      environment[key],
      `${label}.${normalizedKey}`,
      context
    );
  }
  return normalized;
}

function normalizeCiPorts(value, label, context) {
  if (typeof value === "undefined") {
    return [];
  }
  if (!Array.isArray(value)) {
    throw invalidCiContract(`${label} must be an array.`, context);
  }
  const ports = value.map((port, index) => {
    const normalized = String(port || "").trim();
    if (!normalized) {
      throw invalidCiContract(`${label}[${index}] must be a non-empty string.`, context);
    }
    return normalized;
  });
  return [...new Set(ports)].sort((left, right) => left.localeCompare(right));
}

function normalizeCiHealthCheck(value, label, context) {
  if (typeof value === "undefined") {
    return null;
  }
  const healthCheck = requirePlainObject(value, label, context);
  rejectUnknownKeys(healthCheck, ["command", "interval", "timeout", "retries"], label, context);
  const command = String(healthCheck.command || "").trim();
  if (!command) {
    throw invalidCiContract(`${label}.command is required.`, context);
  }

  const normalized = { command };
  for (const propertyName of ["interval", "timeout"]) {
    if (typeof healthCheck[propertyName] === "undefined") {
      continue;
    }
    const propertyValue = String(healthCheck[propertyName] || "").trim();
    if (!propertyValue) {
      throw invalidCiContract(`${label}.${propertyName} must be a non-empty string.`, context);
    }
    normalized[propertyName] = propertyValue;
  }

  if (typeof healthCheck.retries !== "undefined") {
    const retries = Number(healthCheck.retries);
    if (!Number.isInteger(retries) || retries < 1) {
      throw invalidCiContract(`${label}.retries must be a positive integer.`, context);
    }
    normalized.retries = retries;
  }
  return normalized;
}

function normalizeCiService(value, index, context) {
  const label = `ci.services[${index}]`;
  const service = requirePlainObject(value, label, context);
  rejectUnknownKeys(service, ["id", "image", "environment", "ports", "healthCheck"], label, context);
  const id = String(service.id || "").trim();
  const image = String(service.image || "").trim();
  if (!CI_SERVICE_ID_PATTERN.test(id)) {
    throw invalidCiContract(
      `${label}.id must match ${CI_SERVICE_ID_PATTERN.source}.`,
      context
    );
  }
  if (!image) {
    throw invalidCiContract(`${label}.image is required.`, context);
  }

  const normalized = {
    id,
    image,
    environment: normalizeCiEnvironment(service.environment, `${label}.environment`, context),
    ports: normalizeCiPorts(service.ports, `${label}.ports`, context)
  };
  const healthCheck = normalizeCiHealthCheck(service.healthCheck, `${label}.healthCheck`, context);
  if (healthCheck) {
    normalized.healthCheck = healthCheck;
  }
  return normalized;
}

function normalizeCiStep(value, index, context) {
  const label = `ci.steps[${index}]`;
  const step = requirePlainObject(value, label, context);
  rejectUnknownKeys(step, ["id", "phase", "label", "command"], label, context);
  const id = String(step.id || "").trim();
  const phase = String(step.phase || "").trim();
  const stepLabel = String(step.label || "").trim();
  const command = String(step.command || "").trim();

  if (!CI_ID_PATTERN.test(id)) {
    throw invalidCiContract(`${label}.id must match ${CI_ID_PATTERN.source}.`, context);
  }
  if (RESERVED_CI_STEP_IDS.has(id)) {
    throw invalidCiContract(`${label}.id "${id}" is reserved by the JSKIT workflow.`, context);
  }
  if (!CI_STEP_PHASES.includes(phase)) {
    throw invalidCiContract(
      `${label}.phase must be one of: ${CI_STEP_PHASES.join(", ")}.`,
      context
    );
  }
  if (!stepLabel) {
    throw invalidCiContract(`${label}.label is required.`, context);
  }
  if (!command) {
    throw invalidCiContract(`${label}.command is required.`, context);
  }

  return {
    id,
    phase,
    label: stepLabel,
    command
  };
}

function normalizeCiContribution(value, context = {}) {
  if (typeof value === "undefined") {
    return {
      environment: {},
      services: [],
      steps: []
    };
  }
  const ci = requirePlainObject(value, "ci", context);
  rejectUnknownKeys(ci, ["environment", "services", "steps"], "ci", context);
  if (typeof ci.services !== "undefined" && !Array.isArray(ci.services)) {
    throw invalidCiContract("ci.services must be an array.", context);
  }
  if (typeof ci.steps !== "undefined" && !Array.isArray(ci.steps)) {
    throw invalidCiContract("ci.steps must be an array.", context);
  }

  return {
    environment: normalizeCiEnvironment(ci.environment, "ci.environment", context),
    services: (ci.services || []).map((service, index) => normalizeCiService(service, index, context)),
    steps: (ci.steps || []).map((step, index) => normalizeCiStep(step, index, context))
  };
}

export {
  CI_STEP_PHASE_BEFORE_VERIFY,
  CI_STEP_PHASES,
  normalizeCiContribution
};
