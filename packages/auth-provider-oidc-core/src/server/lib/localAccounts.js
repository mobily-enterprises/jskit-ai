import { open, readFile } from "node:fs/promises";
import { AUTH_OIDC_PROVIDER_ID } from "../../shared/index.js";

const LOCAL_PROVIDER_ID = "local";

function isTruthy(value) {
  return value === true || value === 1 || value === "1";
}

/**
 * Writes this app's local accounts as JSON Lines for an accounts hub to
 * import: ids, emails, names and the scrypt password fields, unchanged. The
 * file holds password hashes, so it is created owner-only and never replaces
 * an existing file.
 */
async function exportLocalAccounts({ knex, out }) {
  const rows = await knex("auth_local_users as local")
    .leftJoin("users", function joinUsers() {
      this.on("users.auth_provider_user_sid", "=", "local.id").andOnVal("users.auth_provider", "=", LOCAL_PROVIDER_ID);
    })
    .select(
      "local.id",
      "local.email",
      "local.display_name as local_display_name",
      "users.display_name as user_display_name",
      "local.password_algorithm",
      "local.password_version",
      "local.password_salt",
      "local.password_hash",
      "local.disabled"
    )
    .orderBy("local.id");
  let file;
  try {
    file = await open(out, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`${out} already exists; choose a new file.`);
    throw error;
  }
  try {
    for (const row of rows) {
      await file.write(`${JSON.stringify({
        id: row.id,
        email: row.email,
        display_name: row.user_display_name || row.local_display_name,
        password_algorithm: row.password_algorithm,
        password_version: row.password_version,
        password_salt: row.password_salt,
        password_hash: row.password_hash,
        disabled: isTruthy(row.disabled)
      })}\n`);
    }
  } finally {
    await file.close();
  }
  return { exported: rows.length };
}

async function readExportedIds(file) {
  const ids = [];
  for (const line of (await readFile(file, "utf8")).split("\n")) {
    if (!line.trim()) continue;
    const id = String(JSON.parse(line).id || "").trim();
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * Moves this app's users rows from local sign-in to the accounts hub for the
 * accounts listed in the export the hub imported. The hub keeps each local id
 * as its subject, so `auth_provider_user_sid` stays as it is. Dry-run unless
 * `apply` is set.
 */
async function adoptOidcAccounts({ knex, file, apply = false }) {
  const ids = await readExportedIds(file);
  return knex.transaction(async (trx) => {
    const counts = { adopt: 0, alreadyAdopted: 0, notFound: 0, conflicts: 0 };
    for (const id of ids) {
      const rows = await trx("users").where({ auth_provider_user_sid: id })
        .whereIn("auth_provider", [LOCAL_PROVIDER_ID, AUTH_OIDC_PROVIDER_ID]).select("id", "auth_provider");
      const local = rows.find((row) => row.auth_provider === LOCAL_PROVIDER_ID);
      const adopted = rows.find((row) => row.auth_provider === AUTH_OIDC_PROVIDER_ID);
      if (local && adopted) counts.conflicts += 1;
      else if (adopted) counts.alreadyAdopted += 1;
      else if (!local) counts.notFound += 1;
      else {
        counts.adopt += 1;
        if (apply) await trx("users").where({ id: local.id }).update({ auth_provider: AUTH_OIDC_PROVIDER_ID });
      }
    }
    return counts;
  });
}

export { adoptOidcAccounts, exportLocalAccounts };
