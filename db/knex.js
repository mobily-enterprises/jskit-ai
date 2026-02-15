import knex from "knex";
import knexEnvironments from "../knexfile.cjs";
import { env } from "../lib/env.js";

function resolveRuntimeEnv(nodeEnv) {
  if (nodeEnv === "production") {
    return "production";
  }

  if (nodeEnv === "test") {
    return "test";
  }

  return "development";
}

const NODE_ENV = resolveRuntimeEnv(env.NODE_ENV);
const knexConfig = knexEnvironments[NODE_ENV];

if (!knexConfig) {
  throw new Error(`Missing knex configuration for environment "${NODE_ENV}".`);
}

export const db = knex(knexConfig);

export async function initDatabase() {
  await db.raw("select 1 as ok");
}

export async function closeDatabase() {
  await db.destroy();
}
