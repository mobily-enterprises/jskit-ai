function requireActionIdPrefix(actionIdPrefix) {
  const prefix = String(actionIdPrefix || "").trim();
  if (!prefix) {
    throw new TypeError("createActionIds requires actionIdPrefix.");
  }

  return prefix;
}

function createActionIds(actionIdPrefix) {
  const prefix = requireActionIdPrefix(actionIdPrefix);

  return Object.freeze({
    list: `${prefix}.list`,
    view: `${prefix}.view`,
    create: `${prefix}.create`,
    update: `${prefix}.update`,
    delete: `${prefix}.delete`
  });
}

export { requireActionIdPrefix, createActionIds };
