function parseJsonObject(value) {
  if (value == null) {
    return {};
  }

  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed;
  } catch {
    return {};
  }
}

function stringifyJsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return JSON.stringify(value);
}

function toIso(value) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString();
}

function resolveInsertedId(insertResult) {
  if (Array.isArray(insertResult) && insertResult.length > 0) {
    const first = insertResult[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const objectId = Number(first.id);
      if (Number.isInteger(objectId) && objectId > 0) {
        return objectId;
      }
    }

    const scalarId = Number(first);
    if (Number.isInteger(scalarId) && scalarId > 0) {
      return scalarId;
    }
  }

  const directId = Number(insertResult);
  if (Number.isInteger(directId) && directId > 0) {
    return directId;
  }

  return 0;
}

export { parseJsonObject, stringifyJsonObject, toIso, resolveInsertedId };
