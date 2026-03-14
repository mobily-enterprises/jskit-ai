const CRUD_ACTION_ID_PREFIX = "crud.${option:namespace|snake}";

function createActionIds(actionIdPrefix = CRUD_ACTION_ID_PREFIX) {
  const prefix = String(actionIdPrefix || "").trim();
  if (!prefix) {
    throw new TypeError("createActionIds requires actionIdPrefix.");
  }

  return Object.freeze({
    list: `${prefix}.list`,
    view: `${prefix}.view`,
    create: `${prefix}.create`,
    update: `${prefix}.update`,
    delete: `${prefix}.delete`
  });
}

export { CRUD_ACTION_ID_PREFIX, createActionIds };
