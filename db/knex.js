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

function resolveKnexConfig(nodeEnv, environments) {
  const runtimeEnv = resolveRuntimeEnv(nodeEnv);
  const config = environments[runtimeEnv];
  if (!config) {
    throw new Error(`Missing knex configuration for environment "${runtimeEnv}".`);
  }

  return {
    runtimeEnv,
    config
  };
}

const { runtimeEnv: NODE_ENV, config: knexConfig } = resolveKnexConfig(env.NODE_ENV, knexEnvironments);

export const db = knex(knexConfig);

export async function initDatabase() {
  await initDatabaseWithClient(db);
}

export async function closeDatabase() {
  await closeDatabaseWithClient(db);
}

async function initDatabaseWithClient(knexClient) {
  await knexClient.raw("select 1 as ok");
}

async function closeDatabaseWithClient(knexClient) {
  await knexClient.destroy();
}

export const __testables = {
  resolveRuntimeEnv,
  resolveKnexConfig,
  initDatabaseWithClient,
  closeDatabaseWithClient
};
