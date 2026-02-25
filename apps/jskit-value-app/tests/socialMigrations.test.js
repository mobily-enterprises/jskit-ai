import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const socialMigration = require("../migration-baseline-steps/20260225100000_create_social_federation_tables.cjs");

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
    fn: {
      now() {
        return "NOW()";
      }
    },
    schema
  };

  return { knex, calls };
}

test("social federation migration creates expected tables and drops them in reverse order", async () => {
  const { knex, calls } = createSchemaStub();

  await socialMigration.up(knex);
  await socialMigration.down(knex);

  const createdTables = calls.filter((entry) => entry[0] === "createTable").map((entry) => entry[1]);
  assert.deepEqual(createdTables, [
    "social_actors",
    "social_actor_keys",
    "social_posts",
    "social_post_attachments",
    "social_follows",
    "social_inbox_events",
    "social_outbox_deliveries",
    "social_notifications",
    "social_moderation_rules"
  ]);

  const dropCalls = calls.filter((entry) => entry[0] === "dropTableIfExists").map((entry) => entry[1]);
  assert.deepEqual(dropCalls, [
    "social_moderation_rules",
    "social_notifications",
    "social_outbox_deliveries",
    "social_inbox_events",
    "social_follows",
    "social_post_attachments",
    "social_posts",
    "social_actor_keys",
    "social_actors"
  ]);
});
