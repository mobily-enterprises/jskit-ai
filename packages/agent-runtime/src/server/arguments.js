// The checks every agent-runtime factory makes before it builds anything, so code written for the
// earlier API (a Knex and table names) fails at once, naming what to pass instead.

const OWNER_HINT =
  "list agentResources()'s tables in the owns of one feature (defineFeature({ owns, systemScope })) and pass its setup's " +
  "resources and systemContext";

/**
 * Refuses a store factory's earlier `knex` and `tables`/`table` arguments, then asserts the handles
 * and system context factory it reads through.
 * @param {string} factory The factory's name, for the messages.
 * @param {Record<string, unknown>} dependencies
 * @param {readonly string[]} resourceNames The agentResources() handles it needs.
 */
export function requireStoreDependencies(factory, dependencies, resourceNames) {
  for (const name of ["knex", "tables", "table"]) {
    if (dependencies && Object.hasOwn(dependencies, name)) {
      throw new TypeError(`${factory} no longer takes ${name}: it reads and writes through the agent tables' handles; ${OWNER_HINT}.`);
    }
  }
  const resources = dependencies?.resources;
  // readable-check: allow method-probe - input validation: each handle the owner feature's setup received
  const missing = resourceNames.filter((name) => !resources || typeof resources[name]?.withTransaction !== "function");
  if (missing.length > 0) {
    throw new TypeError(`${factory} requires resources.${missing.join(" and resources.")}, the handles of the agent's tables: ${OWNER_HINT}.`);
  }
  // readable-check: allow method-probe - input validation: the owner feature's system context factory
  if (typeof dependencies.systemContext !== "function") {
    throw new TypeError(`${factory} requires systemContext, the owner feature's system context factory: ${OWNER_HINT}.`);
  }
}

const PLANNING_METHODS = Object.freeze(["currentTodos", "mergeTodos", "jobNotes", "setJobNotes"]);

/**
 * Refuses the earlier `knex` and `tables` planning arguments and asserts the app's planning store
 * (AgentPlanning, types.js) has each method the planning tools call.
 * @param {string} caller
 * @param {unknown} planning
 */
export function requirePlanning(caller, planning) {
  const store = /** @type {Record<string, unknown>} */ (planning);
  const hasMethods = Boolean(planning) && typeof planning === "object" &&
    // readable-check: allow method-probe - input validation: the app's planning store
    PLANNING_METHODS.every((name) => typeof store[name] === "function");
  if (!hasMethods) {
    throw new TypeError(
      `${caller} takes planning, the app's store for to-do cards and job notes (AgentPlanning: ${PLANNING_METHODS.join(", ")}), ` +
      "on the messages and conversations the app owns; it no longer takes a Knex or table names."
    );
  }
}

/**
 * Refuses defaultTools' and planningTools' earlier `knex` and `tables` options.
 * @param {string} caller
 * @param {Record<string, unknown>} options The options the caller does not take.
 */
export function refusePlanningKnex(caller, options) {
  for (const name of ["knex", "tables"]) {
    if (options && Object.hasOwn(options, name)) {
      throw new TypeError(
        `${caller} no longer takes ${name}: pass planning, the app's store for to-do cards and job notes ` +
        `(AgentPlanning: ${PLANNING_METHODS.join(", ")}), on the messages and conversations the app owns.`
      );
    }
  }
}
