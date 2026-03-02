import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { isPlainObject } from "@jskit-ai/action-runtime-core/server";

function normalizeObject(value) {
  return isPlainObject(value) ? value : {};
}

function validationError(fieldErrors) {
  return new AppError(400, "Validation failed.", {
    details: {
      fieldErrors
    }
  });
}

function normalizeExtensionId(value) {
  return String(value || "").trim();
}

function normalizeExtensionValue(value, extensionId, sourceLabel) {
  if (value == null) {
    return {};
  }

  if (!isPlainObject(value)) {
    throw new TypeError(`Settings extension "${extensionId}" ${sourceLabel} must return an object.`);
  }

  return value;
}

function normalizeValidator(validator, extensionId, index) {
  if (typeof validator === "function") {
    return Object.freeze({
      id: `${extensionId}.validator.${index}`,
      validate: validator
    });
  }

  if (isPlainObject(validator) && typeof validator.validate === "function") {
    const validatorId = String(validator.id || `${extensionId}.validator.${index}`).trim();
    return Object.freeze({
      id: validatorId || `${extensionId}.validator.${index}`,
      validate: validator.validate
    });
  }

  throw new TypeError(`Settings extension "${extensionId}" validator[${index}] must be a function or { validate() }.`);
}

function normalizeFieldErrors(value, fallbackField = "request") {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return {
      [fallbackField]: value
    };
  }

  if (!isPlainObject(value)) {
    return null;
  }

  const source = isPlainObject(value.fieldErrors) ? value.fieldErrors : value;
  const normalized = {};

  for (const [fieldId, fieldMessage] of Object.entries(source)) {
    const message = String(fieldMessage || "").trim();
    if (!message) {
      continue;
    }
    normalized[String(fieldId || "").trim() || fallbackField] = message;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeSettingsExtensionEntry(rawEntry, index) {
  const source = isPlainObject(rawEntry) ? rawEntry : {};
  const id = normalizeExtensionId(source.id);
  if (!id) {
    throw new TypeError(`settingsExtensions[${index}] must define a non-empty id.`);
  }

  const validatorsSource = Array.isArray(source.validators) ? source.validators : [];
  const persistenceSource = isPlainObject(source.persistence) ? source.persistence : {};
  const fields = Array.isArray(source.fields) ? source.fields.slice() : [];

  return Object.freeze({
    id,
    fields: Object.freeze(fields),
    validators: Object.freeze(validatorsSource.map((validator, validatorIndex) => normalizeValidator(validator, id, validatorIndex))),
    read: typeof persistenceSource.read === "function" ? persistenceSource.read : async () => ({}),
    write: typeof persistenceSource.write === "function" ? persistenceSource.write : null,
    projection: typeof source.projection === "function" ? source.projection : null
  });
}

function createSettingsExtensionsRuntime({ settingsExtensions = [] } = {}) {
  const source = Array.isArray(settingsExtensions) ? settingsExtensions : [];
  const extensionsById = new Map();

  for (let index = 0; index < source.length; index += 1) {
    const normalizedEntry = normalizeSettingsExtensionEntry(source[index], index);
    if (extensionsById.has(normalizedEntry.id)) {
      throw new TypeError(`Settings extension "${normalizedEntry.id}" is duplicated.`);
    }
    extensionsById.set(normalizedEntry.id, normalizedEntry);
  }

  function requireExtension(extensionId) {
    const normalizedId = normalizeExtensionId(extensionId);
    if (!normalizedId) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            extensionId: "extensionId is required."
          }
        }
      });
    }

    const extension = extensionsById.get(normalizedId);
    if (!extension) {
      throw new AppError(404, `Settings extension "${normalizedId}" not found.`);
    }

    return extension;
  }

  async function applyProjection(extension, value, context) {
    if (typeof extension.projection !== "function") {
      return value;
    }

    const projected = await extension.projection({
      ...context,
      extensionId: extension.id,
      fields: extension.fields,
      value
    });

    return normalizeExtensionValue(projected, extension.id, "projection");
  }

  async function runValidators(extension, payload, context) {
    const fieldErrors = {};

    for (const validator of extension.validators) {
      const result = await validator.validate({
        ...context,
        extensionId: extension.id,
        fields: extension.fields,
        payload
      });

      const normalizedErrors = normalizeFieldErrors(result, validator.id || "request");
      if (!normalizedErrors) {
        continue;
      }

      for (const [fieldId, message] of Object.entries(normalizedErrors)) {
        fieldErrors[fieldId] = message;
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw validationError(fieldErrors);
    }
  }

  function createExtensionResponse(extension, value) {
    return {
      extensionId: extension.id,
      fields: extension.fields,
      value
    };
  }

  async function read(extensionId, context = {}) {
    const extension = requireExtension(extensionId);
    const normalizedContext = normalizeObject(context);

    const value = normalizeExtensionValue(
      await extension.read({
        ...normalizedContext,
        extensionId: extension.id,
        fields: extension.fields
      }),
      extension.id,
      "persistence.read"
    );

    const projected = await applyProjection(extension, value, normalizedContext);
    return createExtensionResponse(extension, projected);
  }

  async function update(extensionId, payload, context = {}) {
    const extension = requireExtension(extensionId);
    if (typeof extension.write !== "function") {
      throw new AppError(405, `Settings extension "${extension.id}" is read-only.`);
    }

    const normalizedPayload = normalizeObject(payload);
    const normalizedContext = normalizeObject(context);

    await runValidators(extension, normalizedPayload, normalizedContext);

    const writtenValue = await extension.write({
      ...normalizedContext,
      extensionId: extension.id,
      fields: extension.fields,
      payload: normalizedPayload
    });

    const value = normalizeExtensionValue(
      writtenValue == null
        ? await extension.read({
            ...normalizedContext,
            extensionId: extension.id,
            fields: extension.fields
          })
        : writtenValue,
      extension.id,
      "persistence.write"
    );

    const projected = await applyProjection(extension, value, normalizedContext);
    return createExtensionResponse(extension, projected);
  }

  return Object.freeze({
    read,
    update
  });
}

const __testables = {
  isPlainObject,
  normalizeObject,
  normalizeExtensionId,
  normalizeExtensionValue,
  normalizeValidator,
  normalizeFieldErrors,
  normalizeSettingsExtensionEntry
};

export { createSettingsExtensionsRuntime, __testables };
