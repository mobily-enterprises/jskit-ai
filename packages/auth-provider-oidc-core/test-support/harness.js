import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import createKnex from "knex";
import migration from "../migrations/auth_oidc_initial.cjs";
import { resolveOidcConfig } from "../src/server/lib/config.js";
import { createIssuerClient } from "../src/server/lib/issuer.js";
import { createBackchannelLogout } from "../src/server/lib/backchannelLogout.js";
import { createOidcAuthService } from "../src/server/lib/service.js";
import { createOidcStore } from "../src/server/lib/store.js";
import { followAuthorization } from "./mockIssuer.js";

const APP_ORIGIN = "http://localhost:5173";

async function createDatabase() {
  const knex = createKnex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await migration.up(knex);
  // The users-core table this provider's profiles land in.
  await knex.schema.createTable("users", (table) => {
    table.increments("id").primary();
    table.string("auth_provider").notNullable();
    table.string("auth_provider_user_sid").notNullable();
    table.string("email").notNullable();
    table.string("display_name").notNullable();
    table.unique(["auth_provider", "auth_provider_user_sid"]);
    table.unique(["email"]);
  });
  return knex;
}

// Stands in for users-core: one users row per (auth_provider, auth_provider_user_sid).
function createProfileProjector(knex) {
  async function findByIdentity(profile) {
    const row = await knex("users").where({ auth_provider: profile.authProvider, auth_provider_user_sid: profile.authProviderUserSid }).first();
    return row ? { id: String(row.id), email: row.email, displayName: row.display_name } : null;
  }
  return {
    findByIdentity,
    async syncIdentityProfile(profile) {
      const existing = await findByIdentity(profile);
      if (existing) {
        await knex("users").where({ id: existing.id }).update({ email: profile.email, display_name: profile.displayName });
      } else {
        await knex("users").insert({
          auth_provider: profile.authProvider,
          auth_provider_user_sid: profile.authProviderUserSid,
          email: profile.email,
          display_name: profile.displayName
        });
      }
      return findByIdentity(profile);
    }
  };
}

async function createRelyingParty({ issuer, env = {}, fetchImpl = null, now = Date.now } = {}) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "jskit-oidc-rp-"));
  const knex = await createDatabase();
  const config = resolveOidcConfig({
    appRoot,
    env: {
      NODE_ENV: "development",
      AUTH_OIDC_ISSUER: issuer.issuer,
      AUTH_OIDC_REGISTRATION_TOKEN: issuer.registrationToken,
      ...env
    }
  });
  const store = createOidcStore({ knex, now });
  const issuerClient = createIssuerClient({ config, store, fetchImpl, now });
  const service = createOidcAuthService({
    config,
    store,
    issuer: issuerClient,
    profileProjector: createProfileProjector(knex),
    now
  });
  const backchannel = createBackchannelLogout({ config, store, issuer: issuerClient, now });
  return {
    knex,
    config,
    store,
    issuerClient,
    service,
    backchannel,
    async close() {
      await knex.destroy();
      await rm(appRoot, { recursive: true, force: true });
    }
  };
}

function requestAt(origin = APP_ORIGIN, cookies = {}) {
  const url = new URL(origin);
  return { headers: { host: url.host }, protocol: url.protocol.slice(0, -1), cookies, socket: { remoteAddress: "127.0.0.1" } };
}

/** Starts a sign-in, lets the issuer sign the test account in, and returns the callback. */
async function signInAtIssuer(rp, { origin = APP_ORIGIN, returnTo = "/home" } = {}) {
  const started = await rp.service.oauthStart({ provider: "oidc", returnTo }, requestAt(origin));
  const callback = await followAuthorization(started.url, { redirectPrefix: `${origin}/auth/login` });
  return {
    started,
    callback,
    input: {
      code: callback.searchParams.get("code"),
      state: callback.searchParams.get("state"),
      iss: callback.searchParams.get("iss") || undefined
    },
    request: requestAt(origin, { jskit_oidc_attempt: started.attempt })
  };
}

export { APP_ORIGIN, createRelyingParty, requestAt, signInAtIssuer };
