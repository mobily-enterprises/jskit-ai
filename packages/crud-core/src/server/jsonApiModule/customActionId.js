/**
 * The action id of a CRUD custom action: its definition's explicit `id`, else `crud.<namespace>.<name>`, the prefix
 * the built-in operations' ids have too. The actions and the routes of a CRUD feature both read it here.
 * @param {string} namespace
 * @param {string} name
 * @param {{ id?: string }} definition
 */
function buildCrudCustomActionId(namespace, name, definition) {
  return String(definition.id || `crud.${namespace}.${name}`).trim();
}

export { buildCrudCustomActionId };
