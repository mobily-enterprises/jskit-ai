import { hasPermission, normalizePermissionList } from "@jskit-ai/kernel/shared/support";
import { isRecord, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeConfig} RuntimeConfig */

/**
 * A grant that covers no required permission, at the role that writes it.
 * @typedef {object} UnknownRoleGrant
 * @property {string} roleId
 * @property {string} grant
 * @property {"unrequired" | "uncovered" | "pattern"} problem An exact name nothing requires, a `<prefix>.*` that
 *   covers nothing required, or a `*` placed where it matches nothing.
 * @property {string[]} suggestions The grants it probably meant, nearest first; none when nothing is close.
 */

// The CRUD operation a grant's last word usually means: an HTTP PATCH is the update operation, and so on.
const OPERATION_WORDS = Object.freeze({
  patch: "update",
  edit: "update",
  put: "update",
  modify: "update",
  read: "view",
  get: "view",
  show: "view",
  index: "list",
  browse: "list",
  add: "create",
  new: "create",
  post: "create",
  insert: "create",
  remove: "delete",
  destroy: "delete"
});

// A misspelling this close to a required name (in single-character edits) is taken to mean it.
const NEAREST_DISTANCE = 2;
// A grant with no close match lists at most this many required names of its namespace.
const MAX_SIBLINGS = 6;

/**
 * The permission names roleCatalog.customPermissions declares, which the application checks itself.
 * @param {RuntimeConfig} config
 * @returns {string[]}
 */
function customPermissionNames(config) {
  const declared = isRecord(config.roleCatalog) ? config.roleCatalog.customPermissions : undefined;
  if (declared === undefined) {
    return [];
  }
  const valid = Array.isArray(declared)
    && declared.every((entry) => typeof entry === "string" && normalizeText(entry) && !entry.includes("*"));
  if (!valid) {
    throw new TypeError(
      "roleCatalog.customPermissions must be a list of permission names (no \"*\"): the permissions the application " +
        "checks itself, in a service, a row policy or the browser."
    );
  }
  return normalizePermissionList(declared);
}

/**
 * Every permission something in the application requires: each registered action's, each HTTP route's `permission`,
 * each surface access policy's `requireAnyPermissions` and `requireAllPermissions`, and the role catalogue's
 * `customPermissions`, which the application checks itself.
 * @param {object} sources
 * @param {ReadonlyArray<{ permission: { permissions: ReadonlyArray<string> } }>} sources.actions The registered action definitions.
 * @param {ReadonlyArray<{ permission?: unknown }>} sources.routes The registered HTTP routes.
 * @param {RuntimeConfig} sources.config
 * @returns {Set<string>}
 */
function collectRequiredPermissions({ actions, routes, config }) {
  const required = new Set(customPermissionNames(config));
  for (const definition of actions) {
    for (const permission of definition.permission.permissions) required.add(permission);
  }
  for (const route of routes) {
    for (const permission of normalizePermissionList(route.permission)) required.add(permission);
  }
  const policies = isRecord(config.surfaceAccessPolicies) ? Object.values(config.surfaceAccessPolicies) : [];
  for (const policy of policies.filter(isRecord)) {
    for (const permission of normalizePermissionList(policy.requireAnyPermissions)) required.add(permission);
    for (const permission of normalizePermissionList(policy.requireAllPermissions)) required.add(permission);
  }
  return required;
}

/** The number of single-character insertions, deletions and substitutions that turn one text into the other. */
function editDistance(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1);
      current.push(Math.min(previous[column] + 1, current[column - 1] + 1, substitution));
    }
    previous = current;
  }
  return previous[right.length];
}

/** The candidate nearest the text within NEAREST_DISTANCE edits, the first in alphabetical order on a tie; else "". */
function nearest(text, candidates) {
  let best = "";
  let bestDistance = NEAREST_DISTANCE + 1;
  // A length further apart than NEAREST_DISTANCE is never that close, so only the rest are measured.
  const close = [...candidates].filter((candidate) => Math.abs(candidate.length - text.length) <= NEAREST_DISTANCE);
  for (const candidate of close.sort()) {
    const distance = editDistance(text, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Every dotted prefix of the required permissions: `crud` and `crud.labels` for `crud.labels.update`. */
function requiredNamespaces(required) {
  const namespaces = new Set();
  for (const permission of required) {
    const words = permission.split(".");
    for (let length = 1; length < words.length; length += 1) namespaces.add(words.slice(0, length).join("."));
  }
  return namespaces;
}

/**
 * The required names an exact grant probably meant: its namespace's permission for the operation its last word
 * usually means, else the nearest required name, else every required name of its namespace.
 * @param {string} grant
 * @param {Set<string>} required
 */
function suggestPermissions(grant, required) {
  const dot = grant.lastIndexOf(".");
  const namespace = dot > 0 ? grant.slice(0, dot) : "";
  const operation = namespace ? OPERATION_WORDS[grant.slice(dot + 1)] : undefined;
  if (operation && required.has(`${namespace}.${operation}`)) {
    return [`${namespace}.${operation}`];
  }
  const close = nearest(grant, required);
  if (close) {
    return [close];
  }
  if (!namespace) {
    return [];
  }
  return [...required]
    .filter((permission) => permission.startsWith(`${namespace}.`) && !permission.slice(dot + 1).includes("."))
    .sort()
    .slice(0, MAX_SIBLINGS);
}

/**
 * One grant checked against the required permissions: null when it covers one, as hasPermission() reads a grant
 * (`*` covers everything, even when nothing is required yet). Only a grant with a `*` can cover a name other than
 * its own, so only those are compared with every required name.
 * @param {string} grant
 * @param {Set<string>} required
 * @returns {Pick<UnknownRoleGrant, "problem" | "suggestions"> | null}
 */
function checkGrant(grant, required) {
  if (grant === "*" || required.has(grant)) {
    return null;
  }
  if (grant.includes("*") && [...required].some((permission) => hasPermission([grant], permission))) {
    return null;
  }
  if (grant.endsWith(".*") && !grant.slice(0, -2).includes("*")) {
    const close = nearest(grant.slice(0, -2), requiredNamespaces(required));
    return { problem: "uncovered", suggestions: close ? [`${close}.*`] : [] };
  }
  if (grant.includes("*")) {
    return { problem: "pattern", suggestions: [] };
  }
  return { problem: "unrequired", suggestions: suggestPermissions(grant, required) };
}

/**
 * The grants of the role catalogue's roles (`roleCatalog.roles.<id>.permissions`) that cover no required
 * permission. Each is reported at the role that writes it, not at the roles that inherit it.
 * @param {RuntimeConfig} config
 * @param {Set<string>} required What collectRequiredPermissions() answers.
 * @returns {UnknownRoleGrant[]}
 */
function findUnknownRoleGrants(config, required) {
  const roles = isRecord(config.roleCatalog) && isRecord(config.roleCatalog.roles) ? config.roleCatalog.roles : {};
  const found = [];
  for (const [roleId, role] of Object.entries(roles)) {
    const grants = isRecord(role) ? normalizePermissionList(role.permissions) : [];
    for (const grant of grants) {
      const problem = checkGrant(grant, required);
      if (problem) found.push({ roleId, grant, ...problem });
    }
  }
  return found;
}

function quoted(names) {
  return names.map((name) => `"${name}"`).join(", ");
}

/** @param {UnknownRoleGrant} finding */
function describeFinding({ roleId, grant, problem, suggestions }) {
  const start = `Role "${roleId}" grants "${grant}"`;
  if (problem === "pattern") {
    return `${start}, which matches nothing: "*" stands alone or ends a grant as ".*".`;
  }
  const reason = problem === "uncovered" ? "which covers no permission an action requires" : "which no action requires";
  if (suggestions.length === 0) {
    return `${start}, ${reason}.`;
  }
  return `${start}, ${reason}; did you mean ${suggestions.length === 1 ? "" : "one of "}${quoted(suggestions)}?`;
}

/**
 * What a startup error or warning says about the grants findUnknownRoleGrants() found: each grant, what to do about a
 * permission the application checks in its own code (which this check cannot see), then how JSKIT names permissions.
 * @param {ReadonlyArray<UnknownRoleGrant>} findings
 */
function describeUnknownRoleGrants(findings) {
  return [
    "The workspace role catalogue (roleCatalog.roles) grants permissions that nothing in the application requires, " +
      "so those roles lack the access that was meant:",
    ...findings.map((finding) => `- ${describeFinding(finding)}`),
    "Before removing or renaming a grant, search the application's own code for that permission (hasPermission(), " +
      "can(), permission string checks, including built names such as `crud.${resource}.list`), which this check " +
      "cannot see. If the application checks it, list it in roleCatalog.customPermissions; remove it only when " +
      "nothing uses it.",
    "A CRUD action requires crud.<namespace>.<operation>, where the operation is list, view, create, update or delete " +
      "(an HTTP PATCH is update), and a custom CRUD action crud.<namespace>.<action name>. \"*\" grants every " +
      "permission and \"<prefix>.*\" every permission under the prefix."
  ].join("\n");
}

export { collectRequiredPermissions, describeUnknownRoleGrants, findUnknownRoleGrants };
