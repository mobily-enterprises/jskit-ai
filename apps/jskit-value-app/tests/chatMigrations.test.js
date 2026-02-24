import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const userSettingsAndBlocksMigration = require("../migration-baseline-steps/20260222190000_create_chat_user_settings_and_blocks.cjs");
const threadsAndParticipantsMigration = require("../migration-baseline-steps/20260222190100_create_chat_threads_and_participants.cjs");
const messagesAndAttachmentsMigration = require("../migration-baseline-steps/20260222190200_create_chat_messages_and_attachments.cjs");
const tombstonesMigration = require("../migration-baseline-steps/20260222190300_create_chat_message_idempotency_tombstones.cjs");
const reactionsMigration = require("../migration-baseline-steps/20260222190400_create_chat_reactions_and_indexes.cjs");
const workspaceRoomUniquenessMigration = require("../migration-baseline-steps/20260223090000_enforce_unique_workspace_room_thread.cjs");

function createSchemaStub() {
  const calls = [];

  function chainableColumn(column, tableCalls) {
    return {
      unsigned() {
        tableCalls.push(["unsigned", column]);
        return this;
      },
      notNullable() {
        tableCalls.push(["notNullable", column]);
        return this;
      },
      nullable() {
        tableCalls.push(["nullable", column]);
        return this;
      },
      defaultTo(value) {
        tableCalls.push(["defaultTo", column, value]);
        return this;
      },
      primary() {
        tableCalls.push(["primary", column]);
        return this;
      },
      unique() {
        tableCalls.push(["unique", column]);
        return this;
      }
    };
  }

  function createTableBuilder(tableCalls) {
    return {
      bigIncrements(column) {
        tableCalls.push(["bigIncrements", column]);
        return chainableColumn(column, tableCalls);
      },
      bigInteger(column) {
        tableCalls.push(["bigInteger", column]);
        return chainableColumn(column, tableCalls);
      },
      integer(column) {
        tableCalls.push(["integer", column]);
        return chainableColumn(column, tableCalls);
      },
      boolean(column) {
        tableCalls.push(["boolean", column]);
        return chainableColumn(column, tableCalls);
      },
      string(column, length) {
        tableCalls.push(["string", column, length]);
        return chainableColumn(column, tableCalls);
      },
      text(column, textType) {
        tableCalls.push(["text", column, textType]);
        return chainableColumn(column, tableCalls);
      },
      binary(column, length) {
        tableCalls.push(["binary", column, length]);
        return chainableColumn(column, tableCalls);
      },
      dateTime(column, options) {
        tableCalls.push(["dateTime", column, options]);
        return chainableColumn(column, tableCalls);
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
      }
    };
  }

  const schema = {
    async hasTable() {
      return true;
    },
    async alterTable(name, callback) {
      calls.push(["alterTable", name]);
      const tableCalls = [];
      const table = {
        unique(columns, indexName) {
          tableCalls.push(["unique", columns, indexName]);
        },
        dropUnique(columns, indexName) {
          tableCalls.push(["dropUnique", columns, indexName]);
        }
      };
      callback(table);
      calls.push(["tableCalls", tableCalls]);
    },
    async createTable(name, callback) {
      calls.push(["createTable", name]);
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

test("chat user settings and blocks migration smoke test", async () => {
  const { knex, calls } = createSchemaStub();
  await userSettingsAndBlocksMigration.up(knex);
  await userSettingsAndBlocksMigration.down(knex);

  const createdTables = calls.filter((entry) => entry[0] === "createTable").map((entry) => entry[1]);
  assert.deepEqual(createdTables, ["chat_user_settings", "chat_user_blocks"]);
  assert.deepEqual(calls[calls.length - 2], ["dropTableIfExists", "chat_user_blocks"]);
  assert.deepEqual(calls[calls.length - 1], ["dropTableIfExists", "chat_user_settings"]);
});

test("chat threads and participants migration smoke test", async () => {
  const { knex, calls } = createSchemaStub();
  await threadsAndParticipantsMigration.up(knex);
  await threadsAndParticipantsMigration.down(knex);

  const createdTables = calls.filter((entry) => entry[0] === "createTable").map((entry) => entry[1]);
  assert.deepEqual(createdTables, ["chat_threads", "chat_thread_participants"]);
  assert.deepEqual(calls[calls.length - 2], ["dropTableIfExists", "chat_thread_participants"]);
  assert.deepEqual(calls[calls.length - 1], ["dropTableIfExists", "chat_threads"]);
});

test("chat messages and attachments migration smoke test includes binary collation statements", async () => {
  const { knex, calls } = createSchemaStub();
  await messagesAndAttachmentsMigration.up(knex);
  await messagesAndAttachmentsMigration.down(knex);

  const rawStatements = calls.filter((entry) => entry[0] === "raw").map((entry) => String(entry[1]));
  assert.ok(
    rawStatements.some((statement) => statement.includes("chat_messages") && statement.includes("utf8mb4_bin"))
  );
  assert.ok(
    rawStatements.some((statement) => statement.includes("chat_attachments") && statement.includes("utf8mb4_bin"))
  );
  assert.deepEqual(calls[calls.length - 2], ["dropTableIfExists", "chat_attachments"]);
  assert.deepEqual(calls[calls.length - 1], ["dropTableIfExists", "chat_messages"]);
});

test("chat idempotency tombstones migration smoke test includes binary collation statement", async () => {
  const { knex, calls } = createSchemaStub();
  await tombstonesMigration.up(knex);
  await tombstonesMigration.down(knex);

  const rawStatements = calls.filter((entry) => entry[0] === "raw").map((entry) => String(entry[1]));
  assert.ok(
    rawStatements.some(
      (statement) => statement.includes("chat_message_idempotency_tombstones") && statement.includes("utf8mb4_bin")
    )
  );
  assert.deepEqual(calls[calls.length - 1], ["dropTableIfExists", "chat_message_idempotency_tombstones"]);
});

test("chat reactions migration smoke test", async () => {
  const { knex, calls } = createSchemaStub();
  await reactionsMigration.up(knex);
  await reactionsMigration.down(knex);

  const createdTables = calls.filter((entry) => entry[0] === "createTable").map((entry) => entry[1]);
  assert.deepEqual(createdTables, ["chat_message_reactions"]);
  assert.deepEqual(calls[calls.length - 1], ["dropTableIfExists", "chat_message_reactions"]);
});

test("workspace room uniqueness migration adds and removes workspace/thread_kind index", async () => {
  const { knex, calls } = createSchemaStub();
  await workspaceRoomUniquenessMigration.up(knex);
  await workspaceRoomUniquenessMigration.down(knex);

  const tableCallsEntries = calls.filter((entry) => entry[0] === "tableCalls");
  assert.deepEqual(tableCallsEntries[0][1][0], [
    "unique",
    ["workspace_id", "thread_kind"],
    "uq_chat_threads_workspace_thread_kind"
  ]);
  assert.deepEqual(tableCallsEntries[1][1][0], [
    "dropUnique",
    ["workspace_id", "thread_kind"],
    "uq_chat_threads_workspace_thread_kind"
  ]);
});
