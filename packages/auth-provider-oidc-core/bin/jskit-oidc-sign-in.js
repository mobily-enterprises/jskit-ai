#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import createKnex from "knex";
import { adoptOidcAccounts, exportLocalAccounts } from "../src/server/lib/localAccounts.js";

const USAGE = `Usage (run in the app's folder, with its database Env):
  jskit-oidc-sign-in export-local-accounts --out <file>
  jskit-oidc-sign-in adopt-oidc --issuer <url> --in <file> [--apply]

export-local-accounts writes this app's local accounts for an accounts hub to import.
adopt-oidc moves the users rows listed in that file to the hub; it only reports
counts unless --apply is given.`;

async function appKnex() {
  try {
    process.loadEnvFile?.(".env");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const knexfile = await import(pathToFileURL(path.resolve("knexfile.js")).href);
  return createKnex(knexfile.default);
}

function sameAddress(left, right) {
  return String(left || "").replace(/\/+$/u, "") === String(right || "").replace(/\/+$/u, "");
}

async function main(argv) {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      out: { type: "string" },
      in: { type: "string" },
      issuer: { type: "string" },
      apply: { type: "boolean", default: false }
    }
  });
  if (command === "export-local-accounts" && values.out) {
    const knex = await appKnex();
    try {
      const { exported } = await exportLocalAccounts({ knex, out: path.resolve(values.out) });
      console.log(`Exported ${exported} accounts to ${values.out}. It contains password hashes: delete it after the import.`);
    } finally {
      await knex.destroy();
    }
    return 0;
  }
  if (command === "adopt-oidc" && values.issuer && values.in) {
    const configured = process.env.AUTH_OIDC_ISSUER;
    if (configured && !sameAddress(configured, values.issuer)) {
      throw new Error(`--issuer does not match AUTH_OIDC_ISSUER (${configured}).`);
    }
    const knex = await appKnex();
    try {
      const counts = await adoptOidcAccounts({ knex, file: path.resolve(values.in), apply: values.apply });
      const verb = values.apply ? "Adopted" : "Would adopt";
      console.log(`${verb} ${counts.adopt} accounts, ${counts.alreadyAdopted} already adopted, ` +
        `${counts.notFound} not found, ${counts.conflicts} conflicts.`);
    } finally {
      await knex.destroy();
    }
    return 0;
  }
  console.error(USAGE);
  return 2;
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}, (error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
