import knex from "knex";
import knexEnvironments from "../knexfile.cjs";
import { env } from "../lib/env.js";

const NODE_ENV = env.NODE_ENV === "production" ? "production" : "development";
const knexConfig = knexEnvironments[NODE_ENV];

export const db = knex(knexConfig);

export async function initDatabase() {
  await db.raw("select 1 as ok");
}

export async function closeDatabase() {
  await db.destroy();
}
