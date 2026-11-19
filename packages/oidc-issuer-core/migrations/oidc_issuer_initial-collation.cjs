// Knex sorts this file just before oidc_issuer_initial.cjs ("-" sorts before "."), so it runs first on every
// database that has not run it. It runs that released migration with each table it creates in the collation of
// oidc_issuer_accounts, or of the next table listed that exists, instead of the database's default, and repairs a
// table that default left: see migrateInExistingCollation. The released migration then finds its tables in place.
const released = require("./oidc_issuer_initial.cjs");

exports.up = async function up(knex) {
  const { migrateInExistingCollation } = await import("@jskit-ai/database-runtime/server/tableCollationMigrations");
  await migrateInExistingCollation(knex, {
    migration: "oidc_issuer_initial.cjs",
    up: released.up,
    tables: [
      "oidc_issuer_accounts",
      "oidc_issuer_models",
      "oidc_issuer_clients",
      "oidc_issuer_signing_keys",
      "oidc_issuer_email_tokens",
      "oidc_issuer_rate_limits"
    ],
    referenceTables: ["oidc_issuer_accounts", "users", "auth_local_users"]
  });
};

// The released migration's down drops its tables.
exports.down = async function down() {};
