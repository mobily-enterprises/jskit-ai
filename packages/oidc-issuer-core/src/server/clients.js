import { isLoopbackHostname } from "./config.js";
import { MODELS_TABLE } from "./adapter.js";

const CLIENTS_TABLE = "oidc_issuer_clients";
const DEV_CLIENT_IDLE_DAYS = 30;

const ACCEPTED_FIELDS = new Set([
  "client_name",
  "redirect_uris",
  "post_logout_redirect_uris",
  "backchannel_logout_uri",
  "token_endpoint_auth_method",
  "grant_types",
  "response_types"
]);

class RegistrationError extends Error {
  constructor(error, description, status = 400) {
    super(description);
    this.error = error;
    this.status = status;
  }
}

function invalid(description) {
  return new RegistrationError("invalid_client_metadata", description);
}

function originOf(uri, field) {
  let url;
  try {
    url = new URL(String(uri));
  } catch {
    throw invalid(`${field} must contain full addresses.`);
  }
  if (url.hash || String(uri).includes("#")) throw invalid(`${field} must not contain a fragment.`);
  if (url.username || url.password) throw invalid(`${field} must not contain a user name or password.`);
  const loopback = isLoopbackHostname(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw invalid(`${field} must use https unless the app runs on this computer.`);
  }
  return url.origin;
}

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, "[a-z0-9-]*");
  return new RegExp(`^${escaped}$`, "u");
}

function isDevelopmentOrigin(origin, patterns) {
  const url = new URL(origin);
  if (isLoopbackHostname(url.hostname)) return true;
  return patterns.some((pattern) => globToRegExp(pattern).test(origin.toLowerCase()));
}

/** An optional list field that, when present, may hold only `value`. */
function assertOnlyValue(body, field, value) {
  const list = body[field];
  if (list !== undefined && !(Array.isArray(list) && list.length === 1 && list[0] === value)) {
    throw invalid(`${field} must be ["${value}"].`);
  }
}

/**
 * Validates a registration (RFC 7591) or update (RFC 7592) body against the
 * hub's policy and returns its single origin and display name.
 */
function validateRegistrationMetadata(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw invalid("The registration must be a JSON object.");
  }
  for (const field of Object.keys(body)) {
    if (!ACCEPTED_FIELDS.has(field)) throw invalid(`${field} is not accepted by this hub.`);
  }
  const name = String(body.client_name ?? "").trim();
  if (!name) throw invalid("client_name is required.");
  if (name.length > 80) throw invalid("client_name must be at most 80 characters.");
  if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length < 1) {
    throw invalid("redirect_uris must list at least one address.");
  }
  if (body.post_logout_redirect_uris !== undefined && !Array.isArray(body.post_logout_redirect_uris)) {
    throw invalid("post_logout_redirect_uris must be a list.");
  }
  if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== "client_secret_basic") {
    throw invalid("token_endpoint_auth_method must be client_secret_basic.");
  }
  assertOnlyValue(body, "grant_types", "authorization_code");
  assertOnlyValue(body, "response_types", "code");
  const origins = new Set([
    ...body.redirect_uris.map((uri) => originOf(uri, "redirect_uris")),
    ...(body.post_logout_redirect_uris || []).map((uri) => originOf(uri, "post_logout_redirect_uris"))
  ]);
  if (body.backchannel_logout_uri !== undefined) {
    const backchannelOrigin = originOf(body.backchannel_logout_uri, "backchannel_logout_uri");
    if (!origins.has(backchannelOrigin)) {
      throw invalid("backchannel_logout_uri must be on the same address as redirect_uris.");
    }
  }
  if (origins.size !== 1) throw invalid("All addresses must be on one origin.");
  return { origin: [...origins][0], name };
}

function createClientStore(knex, { now = () => new Date() } = {}) {
  const table = () => knex(CLIENTS_TABLE);

  async function deleteProviderClient(clientId) {
    await knex(MODELS_TABLE).where({ kind: "Client", id: clientId }).delete();
  }

  async function remove(clientId) {
    await deleteProviderClient(clientId);
    return (await table().where({ client_id: clientId }).delete()) > 0;
  }

  return Object.freeze({
    async get(clientId) {
      return (await table().where({ client_id: String(clientId ?? "") }).first()) || null;
    },

    async list() {
      return table().orderBy("created_at", "desc");
    },

    /** The status a new registration from this origin receives. */
    async statusForOrigin(origin, devOriginPatterns) {
      const rows = await table().where({ origin });
      if (rows.some((row) => row.status === "blocked")) {
        throw new RegistrationError("invalid_redirect_uri", "This address is blocked by the hub's owner.", 403);
      }
      if (isDevelopmentOrigin(origin, devOriginPatterns)) return "active-dev";
      return rows.some((row) => row.status === "active") ? "active" : "pending";
    },

    async insert({ clientId, origin, name, status }) {
      await table().insert({
        client_id: clientId,
        origin,
        client_name: name,
        status,
        created_at: now(),
        approved_at: status === "active" ? now() : null,
        approved_by: null,
        last_used_at: null
      });
    },

    rename(clientId, name) {
      return table().where({ client_id: clientId }).update({ client_name: name });
    },

    async approve(clientId, accountId) {
      const updated = await table()
        .where({ client_id: clientId, status: "pending" })
        .update({ status: "active", approved_at: now(), approved_by: accountId });
      return updated > 0;
    },

    async blockOrigin(clientId) {
      const row = await table().where({ client_id: clientId }).first();
      if (!row) return false;
      const siblings = await table().where({ origin: row.origin });
      for (const sibling of siblings) await deleteProviderClient(sibling.client_id);
      await table().where({ origin: row.origin }).update({ status: "blocked" });
      return true;
    },

    remove,

    touch(clientId) {
      return table().where({ client_id: clientId }).update({ last_used_at: now() });
    },

    async removeIdleDevelopmentClients() {
      const cutoff = new Date(now().getTime() - DEV_CLIENT_IDLE_DAYS * 86400 * 1000);
      const idle = await table()
        .where({ status: "active-dev" })
        .andWhere((query) => query
          .where("last_used_at", "<", cutoff)
          .orWhere((inner) => inner.whereNull("last_used_at").andWhere("created_at", "<", cutoff)));
      for (const row of idle) await remove(row.client_id);
      return idle.length;
    }
  });
}

export {
  CLIENTS_TABLE,
  RegistrationError,
  createClientStore,
  isDevelopmentOrigin,
  validateRegistrationMetadata
};
