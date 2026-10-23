import { createServer } from "node:net";
import Fastify from "fastify";
import createKnex from "knex";
import { createOidcIssuer } from "../../src/server/issuer.js";

const migration = (await import("../../migrations/oidc_issuer_initial.cjs")).default;

const REGISTRATION_TOKEN = "test-registration-token-0123456789abcdef";
const OWNER_EMAIL = "owner@example.test";
const silentLogger = { info() {}, warn(...args) { if (process.env.HUB_TEST_DEBUG) console.warn(...args); }, error(...args) { if (process.env.HUB_TEST_DEBUG) console.error(...args); }, debug() {} };

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function createDatabase() {
  const knex = createKnex({
    client: "better-sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 }
  });
  await migration.up(knex);
  return knex;
}

function createCapturingMailer() {
  const sent = [];
  return {
    sent,
    configured: true,
    async send(message) {
      sent.push(message);
    },
    lastLink() {
      const text = sent.at(-1)?.text || "";
      return /https?:\/\/\S+/u.exec(text.split("\n").reverse().find((line) => line.includes("http")) || "")?.[0] || "";
    }
  };
}

/**
 * Starts a real hub on a loopback port with an in-memory database. `restart`
 * builds a fresh hub process on the same database and address.
 */
async function startHub({ env = {}, knex = null, port = null, now, googleEndpoints, fetchImpl } = {}) {
  const database = knex || (await createDatabase());
  const listenPort = port || (await freePort());
  const mailer = createCapturingMailer();
  const issuerUrl = `http://127.0.0.1:${listenPort}`;
  const app = Fastify({ logger: false, forceCloseConnections: true });
  const issuer = await createOidcIssuer({
    knex: database,
    env: {
      APP_PUBLIC_URL: issuerUrl,
      OIDC_HUB_SECRET: "a-test-hub-secret-that-is-long-enough-0123456789",
      OIDC_HUB_REGISTRATION_TOKEN: REGISTRATION_TOKEN,
      OIDC_HUB_OWNER_EMAIL: OWNER_EMAIL,
      ...env
    },
    logger: silentLogger,
    mailer,
    now,
    googleEndpoints,
    fetchImpl
  });
  await issuer.mount(app);
  await app.listen({ port: listenPort, host: "127.0.0.1" });
  return {
    app,
    issuer,
    knex: database,
    mailer,
    url: issuerUrl,
    port: listenPort,
    async stop({ keepDatabase = false } = {}) {
      await issuer.close();
      await app.close();
      // Let the client side notice the closed keep-alive sockets.
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (!keepDatabase) await database.destroy();
    },
    async restart() {
      await this.stop({ keepDatabase: true });
      return startHub({ env, knex: database, port: listenPort, now, googleEndpoints, fetchImpl });
    }
  };
}

export { OWNER_EMAIL, REGISTRATION_TOKEN, createDatabase, freePort, silentLogger, startHub };
