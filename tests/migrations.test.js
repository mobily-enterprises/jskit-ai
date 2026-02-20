import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const userProfilesMigration = require("../migrations/20260215120000_create_user_profiles.cjs");
const calculationLogsMigration = require("../migrations/20260215120100_create_calculation_logs.cjs");
const userSettingsMigration = require("../migrations/20260216110000_create_user_settings.cjs");
const userAvatarColumnsMigration = require("../migrations/20260216230000_add_user_avatar_columns.cjs");
const consoleMembershipsMigration = require("../migrations/20260220090000_create_console_memberships.cjs");
const consoleInvitesMigration = require("../migrations/20260220090100_create_console_invites.cjs");
const consoleRootIdentityMigration = require("../migrations/20260220090200_create_console_root_identity.cjs");
const consoleBrowserErrorsMigration = require("../migrations/20260220100000_create_console_browser_errors.cjs");
const consoleServerErrorsMigration = require("../migrations/20260220100100_create_console_server_errors.cjs");
const securityAuditEventsMigration = require("../migrations/20260220110000_create_security_audit_events.cjs");
const aiTranscriptsMigration = require("../migrations/20260220130000_create_ai_transcripts.cjs");

function createSchemaStub() {
  const calls = [];
  function createTableBuilder(tableCalls) {
    return {
      bigIncrements(column) {
        tableCalls.push(["bigIncrements", column]);
        return {
          primary() {
            tableCalls.push(["primary"]);
            return this;
          }
        };
      },
      string(column, length) {
        tableCalls.push(["string", column, length]);
        return {
          notNullable() {
            tableCalls.push(["notNullable", column]);
            return this;
          },
          defaultTo(value) {
            tableCalls.push(["defaultTo", column, value]);
            return this;
          },
          unique() {
            tableCalls.push(["unique", column]);
            return this;
          },
          primary() {
            tableCalls.push(["primary", column]);
            return this;
          },
          nullable() {
            tableCalls.push(["nullable", column]);
            return this;
          }
        };
      },
      text(column, textType) {
        tableCalls.push(["text", column, textType]);
        return {
          notNullable() {
            tableCalls.push(["notNullable", column]);
            return this;
          },
          nullable() {
            tableCalls.push(["nullable", column]);
            return this;
          }
        };
      },
      dateTime(column, options) {
        tableCalls.push(["dateTime", column, options]);
        return {
          notNullable() {
            tableCalls.push(["notNullable", column]);
            return this;
          },
          defaultTo(value) {
            tableCalls.push(["defaultTo", column, value]);
            return this;
          },
          nullable() {
            tableCalls.push(["nullable", column]);
            return this;
          }
        };
      },
      enu(column, values) {
        tableCalls.push(["enu", column, values]);
        return {
          notNullable() {
            tableCalls.push(["notNullable", column]);
            return this;
          },
          defaultTo(value) {
            tableCalls.push(["defaultTo", column, value]);
            return this;
          }
        };
      },
      decimal(column, precision, scale) {
        tableCalls.push(["decimal", column, precision, scale]);
        return {
          notNullable() {
            tableCalls.push(["notNullable", column]);
            return this;
          },
          nullable() {
            tableCalls.push(["nullable", column]);
            return this;
          }
        };
      },
      integer(column) {
        tableCalls.push(["integer", column]);
        return {
          unsigned() {
            tableCalls.push(["unsigned", column]);
            return this;
          },
          notNullable() {
            tableCalls.push(["notNullable", column]);
            return this;
          },
          defaultTo(value) {
            tableCalls.push(["defaultTo", column, value]);
            return this;
          },
          nullable() {
            tableCalls.push(["nullable", column]);
            return this;
          }
        };
      },
      bigInteger(column) {
        tableCalls.push(["bigInteger", column]);
        return {
          unsigned() {
            tableCalls.push(["unsigned", column]);
            return this;
          },
          notNullable() {
            tableCalls.push(["notNullable", column]);
            return this;
          },
          primary() {
            tableCalls.push(["primary", column]);
            return this;
          },
          nullable() {
            tableCalls.push(["nullable", column]);
            return this;
          }
        };
      },
      boolean(column) {
        tableCalls.push(["boolean", column]);
        return {
          notNullable() {
            tableCalls.push(["notNullable", column]);
            return this;
          },
          defaultTo(value) {
            tableCalls.push(["defaultTo", column, value]);
            return this;
          }
        };
      },
      foreign(column) {
        tableCalls.push(["foreign", column]);
        return {
          references(reference) {
            tableCalls.push(["references", column, reference]);
            return {
              inTable(tableName) {
                tableCalls.push(["inTable", column, tableName]);
                return {
                  onDelete(rule) {
                    tableCalls.push(["onDelete", column, rule]);
                    return this;
                  }
                };
              }
            };
          }
        };
      },
      index(columns, name) {
        tableCalls.push(["index", columns, name]);
      },
      unique(columns, name) {
        tableCalls.push(["unique", columns, name]);
      },
      dropColumn(column) {
        tableCalls.push(["dropColumn", column]);
      }
    };
  }

  const schema = {
    async hasTable(name) {
      calls.push(["hasTable", name]);
      return false;
    },
    async createTable(name, callback) {
      calls.push(["createTable", name]);
      const tableCalls = [];
      const table = createTableBuilder(tableCalls);
      callback(table);
      calls.push(["tableCalls", tableCalls]);
    },
    async alterTable(name, callback) {
      calls.push(["alterTable", name]);
      const tableCalls = [];
      const table = createTableBuilder(tableCalls);
      callback(table);
      calls.push(["tableCalls", tableCalls]);
    },
    async dropTableIfExists(name) {
      calls.push(["dropTableIfExists", name]);
    }
  };

  const knex = {
    schema,
    raw(value) {
      calls.push(["raw", value]);
      return `RAW(${value})`;
    }
  };

  return { knex, calls };
}

test("user profiles migration creates and drops expected table", async () => {
  const { knex, calls } = createSchemaStub();

  await userProfilesMigration.up(knex);
  await userProfilesMigration.down(knex);

  assert.equal(calls[0][0], "createTable");
  assert.equal(calls[0][1], "user_profiles");
  assert.ok(calls.some((entry) => entry[0] === "raw" && entry[1] === "UTC_TIMESTAMP(3)"));
  assert.deepEqual(calls[calls.length - 1], ["dropTableIfExists", "user_profiles"]);
});

test("calculation logs migration creates and drops expected table", async () => {
  const { knex, calls } = createSchemaStub();

  await calculationLogsMigration.up(knex);
  await calculationLogsMigration.down(knex);

  assert.equal(calls[0][0], "createTable");
  assert.equal(calls[0][1], "calculation_logs");
  assert.ok(calls.some((entry) => entry[0] === "raw" && entry[1] === "UTC_TIMESTAMP(3)"));
  assert.deepEqual(calls[calls.length - 1], ["dropTableIfExists", "calculation_logs"]);
});

test("user settings migration creates and drops expected table", async () => {
  const { knex, calls } = createSchemaStub();

  await userSettingsMigration.up(knex);
  await userSettingsMigration.down(knex);

  assert.equal(calls[0][0], "createTable");
  assert.equal(calls[0][1], "user_settings");
  assert.ok(calls.some((entry) => entry[0] === "raw" && entry[1] === "UTC_TIMESTAMP(3)"));
  assert.deepEqual(calls[calls.length - 1], ["dropTableIfExists", "user_settings"]);
});

test("user avatar columns migration alters expected tables", async () => {
  const { knex, calls } = createSchemaStub();

  await userAvatarColumnsMigration.up(knex);
  await userAvatarColumnsMigration.down(knex);

  assert.equal(calls[0][0], "alterTable");
  assert.equal(calls[0][1], "user_profiles");
  assert.equal(calls[2][0], "alterTable");
  assert.equal(calls[2][1], "user_settings");
  assert.ok(
    calls.some((entry) => entry[0] === "tableCalls" && entry[1].some((tableCall) => tableCall[0] === "dropColumn"))
  );
});

test("console memberships migration creates expected table, singleton guard, and drop behavior", async () => {
  const { knex, calls } = createSchemaStub();

  await consoleMembershipsMigration.up(knex);
  await consoleMembershipsMigration.down(knex);

  assert.equal(calls[0][0], "createTable");
  assert.equal(calls[0][1], "console_memberships");
  assert.ok(calls.some((entry) => entry[0] === "raw" && String(entry[1]).includes("ALTER TABLE console_memberships")));
  assert.deepEqual(calls[calls.length - 1], ["dropTableIfExists", "console_memberships"]);
});

test("console invites migration creates expected table, pending-email guard, and drop behavior", async () => {
  const { knex, calls } = createSchemaStub();

  await consoleInvitesMigration.up(knex);
  await consoleInvitesMigration.down(knex);

  assert.equal(calls[0][0], "createTable");
  assert.equal(calls[0][1], "console_invites");
  assert.ok(calls.some((entry) => entry[0] === "raw" && String(entry[1]).includes("ALTER TABLE console_invites")));
  assert.deepEqual(calls[calls.length - 1], ["dropTableIfExists", "console_invites"]);
});

test("console root identity migration creates expected table and drop behavior", async () => {
  const { knex, calls } = createSchemaStub();

  await consoleRootIdentityMigration.up(knex);
  await consoleRootIdentityMigration.down(knex);

  assert.equal(calls[0][0], "createTable");
  assert.equal(calls[0][1], "console_root_identity");
  assert.ok(calls.some((entry) => entry[0] === "raw" && entry[1] === "UTC_TIMESTAMP(3)"));
  assert.deepEqual(calls[calls.length - 1], ["dropTableIfExists", "console_root_identity"]);
});

test("console browser errors migration creates expected table and drop behavior", async () => {
  const { knex, calls } = createSchemaStub();

  await consoleBrowserErrorsMigration.up(knex);
  await consoleBrowserErrorsMigration.down(knex);

  assert.equal(calls[0][0], "createTable");
  assert.equal(calls[0][1], "console_browser_errors");
  assert.ok(calls.some((entry) => entry[0] === "raw" && entry[1] === "UTC_TIMESTAMP(3)"));
  assert.deepEqual(calls[calls.length - 1], ["dropTableIfExists", "console_browser_errors"]);
});

test("console server errors migration creates expected table and drop behavior", async () => {
  const { knex, calls } = createSchemaStub();

  await consoleServerErrorsMigration.up(knex);
  await consoleServerErrorsMigration.down(knex);

  const createTableCall = calls.find((entry) => entry[0] === "createTable" && entry[1] === "console_server_errors");
  assert.ok(createTableCall);
  assert.ok(calls.some((entry) => entry[0] === "raw" && entry[1] === "UTC_TIMESTAMP(3)"));
  assert.deepEqual(calls[calls.length - 1], ["dropTableIfExists", "console_server_errors"]);
});

test("security audit events migration creates expected table and drop behavior", async () => {
  const { knex, calls } = createSchemaStub();

  await securityAuditEventsMigration.up(knex);
  await securityAuditEventsMigration.down(knex);

  const createTableCall = calls.find((entry) => entry[0] === "createTable" && entry[1] === "security_audit_events");
  assert.ok(createTableCall);
  assert.ok(calls.some((entry) => entry[0] === "raw" && entry[1] === "UTC_TIMESTAMP(3)"));
  assert.deepEqual(calls[calls.length - 1], ["dropTableIfExists", "security_audit_events"]);
});

test("ai transcripts migration creates expected tables and drop behavior", async () => {
  const { knex, calls } = createSchemaStub();

  await aiTranscriptsMigration.up(knex);
  await aiTranscriptsMigration.down(knex);

  const createConversationTableCall = calls.find((entry) => entry[0] === "createTable" && entry[1] === "ai_conversations");
  const createMessageTableCall = calls.find((entry) => entry[0] === "createTable" && entry[1] === "ai_messages");
  assert.ok(createConversationTableCall);
  assert.ok(createMessageTableCall);
  assert.ok(calls.some((entry) => entry[0] === "raw" && entry[1] === "UTC_TIMESTAMP(3)"));

  assert.deepEqual(calls[calls.length - 2], ["dropTableIfExists", "ai_messages"]);
  assert.deepEqual(calls[calls.length - 1], ["dropTableIfExists", "ai_conversations"]);
});
