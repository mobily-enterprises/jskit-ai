import { addFieldError, createFieldErrorBag, hasFieldErrors, hasOwn, isObjectRecord, toValidationError } from "./settingsInfra.js";

function normalizeErrorMessage(error, fallbackMessage) {
  const message = String(error?.message || "").trim();
  return message || String(fallbackMessage || "Value is invalid.");
}

function applyFieldSpec(spec, rawValue, context) {
  if (!isObjectRecord(spec)) {
    return {
      ok: true,
      value: rawValue
    };
  }

  let value = rawValue;

  if (typeof spec.normalize === "function") {
    value = spec.normalize(rawValue, context);
  }

  if (typeof spec.validate === "function") {
    const validation = spec.validate(value, context);
    if (validation === false) {
      return {
        ok: false,
        message: spec.messages?.invalid || `${context.field} is invalid.`
      };
    }
    if (typeof validation === "string" && validation.trim()) {
      return {
        ok: false,
        message: validation
      };
    }
  }

  return {
    ok: true,
    value
  };
}

function buildPatch({
  input,
  fieldSpecs,
  createError,
  requireAtLeastOne = true,
  emptyField = "settings",
  emptyMessage = "At least one field is required.",
  throwOnError = true
} = {}) {
  const payload = isObjectRecord(input) ? input : {};
  const specs = isObjectRecord(fieldSpecs) ? fieldSpecs : {};
  const fieldErrors = createFieldErrorBag();
  const patch = {};
  let touched = 0;

  for (const [field, spec] of Object.entries(specs)) {
    const sourceKey = String(spec?.sourceKey || field);

    if (!hasOwn(payload, sourceKey)) {
      if (spec?.required === true) {
        addFieldError(fieldErrors, field, String(spec?.messages?.required || `${field} is required.`));
      }
      continue;
    }

    touched += 1;

    const context = {
      field,
      sourceKey,
      spec,
      input: payload,
      patch
    };

    try {
      const parsed = applyFieldSpec(spec, payload[sourceKey], context);
      if (!parsed.ok) {
        addFieldError(fieldErrors, field, parsed.message);
        continue;
      }

      if (parsed.value === undefined && spec?.omitIfUndefined !== false) {
        continue;
      }

      if (typeof spec?.setPatch === "function") {
        spec.setPatch(patch, parsed.value, context);
      } else {
        patch[String(spec?.targetKey || field)] = parsed.value;
      }
    } catch (error) {
      addFieldError(fieldErrors, field, normalizeErrorMessage(error, spec?.messages?.invalid || `${field} is invalid.`));
    }
  }

  if (requireAtLeastOne && touched === 0 && !hasFieldErrors(fieldErrors)) {
    addFieldError(fieldErrors, emptyField, emptyMessage);
  }

  if (throwOnError && hasFieldErrors(fieldErrors)) {
    throw toValidationError(createError, fieldErrors);
  }

  return {
    patch,
    fieldErrors
  };
}

export { buildPatch };
