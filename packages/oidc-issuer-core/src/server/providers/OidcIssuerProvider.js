import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createOidcIssuer } from "../issuer.js";

/** Mounts the accounts hub on the application's own Fastify server. */
const OidcIssuerProvider = defineProvider({
  id: "auth.oidc-issuer",
  requires: {
    appRoot: "runtime.app-root",
    database: "runtime.database",
    env: "runtime.env",
    fastify: "runtime.fastify",
    logger: "runtime.logger"
  },
  provides: {
    issuer: "auth.oidc-issuer"
  },
  async setup({ appRoot, database, env, logger }) {
    return {
      issuer: await createOidcIssuer({ knex: database.knex, env, logger, appRoot })
    };
  },
  async boot({ fastify }, { outputs }) {
    await outputs.issuer.mount(fastify);
  },
  async shutdown(_dependencies, { outputs }) {
    await outputs.issuer?.close();
  }
});

export { OidcIssuerProvider };
