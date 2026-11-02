#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createKnexMigrationConfigFromApp } from "@jskit-ai/database-runtime/server/knexMigrationConfig";
import createKnex from "knex";
import { systemClock } from "../src/server/clock.js";
import { resolveHubConfig } from "../src/server/config.js";
import { describeImport, importAccounts } from "../src/server/importAccounts.js";
import { runPreviewIdentityCommand } from "../src/server/previewIdentity.js";
import { createSigningKeyStore } from "../src/server/signingKeys.js";

const USAGE = `Usage:
  jskit-oidc-issuer keys rotate
  jskit-oidc-issuer import-accounts --in <file> [--apply]
  jskit-oidc-issuer preview-identity [--protocol <id>] [--local-hostname <pattern>]...

Run from the hub application's folder; it reads the same .env and database settings.
preview-identity answers one request on stdin: --protocol names the preview host's
protocol id, and each --local-hostname a regular expression for a hostname, besides
loopback, that the host serves the hub on.`;

function loadDotEnv() {
  try {
    process.loadEnvFile(".env");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function withKnex(work) {
  const config = await createKnexMigrationConfigFromApp({ client: process.env.DB_CLIENT || "mysql2", environment: process.env });
  const knex = createKnex({ client: config.client, connection: config.connection });
  try {
    return await work(knex);
  } finally {
    await knex.destroy();
  }
}

/** The preview host's protocol id and hostnames, from `--protocol` and `--local-hostname` arguments. */
function previewIdentityHost(args) {
  const host = { localHostnames: [] };
  for (let index = 0; index < args.length; index += 2) {
    const [flag, value] = [args[index], args[index + 1]];
    if (!value) throw new Error(USAGE);
    if (flag === "--protocol") host.protocol = value;
    else if (flag === "--local-hostname") host.localHostnames.push(new RegExp(value, "u"));
    else throw new Error(USAGE);
  }
  return host;
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === "preview-identity") {
    return runPreviewIdentityCommand({ ...previewIdentityHost(rest), env: process.env });
  }
  loadDotEnv();
  if (command === "keys" && rest[0] === "rotate") {
    const config = resolveHubConfig(process.env, { appRoot: process.cwd() });
    const kid = await withKnex((knex) => createSigningKeyStore({ knex, secret: config.secret, now: systemClock }).rotate());
    console.log(`New signing key ${kid} is active. The previous key keeps verifying for two hours. A running hub picks it up within a minute.`);
    return 0;
  }
  if (command === "import-accounts") {
    const inIndex = rest.indexOf("--in");
    const file = inIndex >= 0 ? rest[inIndex + 1] : "";
    if (!file || !existsSync(path.resolve(file))) {
      console.error("Name the exported accounts file with --in <file>.");
      return 1;
    }
    const apply = rest.includes("--apply");
    const result = await withKnex((knex) => importAccounts({ knex, text: readFileSync(path.resolve(file), "utf8"), apply }));
    console.log(describeImport(result, { apply }));
    return result.conflicts.length > 0 ? 2 : 0;
  }
  console.error(USAGE);
  return 1;
}

process.exitCode = await main(process.argv.slice(2)).catch((error) => {
  console.error(error?.message || String(error));
  return 1;
});
