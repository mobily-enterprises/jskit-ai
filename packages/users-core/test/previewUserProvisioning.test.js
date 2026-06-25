import assert from "node:assert/strict";
import test from "node:test";
import { ensurePreviewUser } from "../src/server/previewUserProvisioning.js";

function matches(row = {}, criteria = {}) {
  return Object.entries(criteria).every(([key, value]) => row[key] === value);
}

function createMemoryDb(initialTables = {}) {
  const tables = {};
  for (const [tableName, rows] of Object.entries(initialTables)) {
    tables[tableName] = rows.map((row) => ({ ...row }));
  }

  function db(tableName) {
    const rows = tables[tableName];
    if (!rows) {
      throw new Error(`Unknown table: ${tableName}`);
    }
    let criteria = {};

    return {
      where(nextCriteria = {}) {
        criteria = { ...criteria, ...nextCriteria };
        return this;
      },
      async first() {
        return rows.find((row) => matches(row, criteria)) || null;
      },
      async insert(record = {}) {
        rows.push({
          id: record.id || String(rows.length + 1),
          ...record
        });
      },
      async update(patch = {}) {
        for (const row of rows.filter((entry) => matches(entry, criteria))) {
          Object.assign(row, patch);
        }
      }
    };
  }

  db.schema = {
    async hasTable(tableName) {
      return Object.hasOwn(tables, tableName);
    }
  };
  db.tables = tables;
  return db;
}

test("ensurePreviewUser creates preview user and settings with package defaults", async () => {
  const db = createMemoryDb({
    users: [],
    user_settings: []
  });

  const result = await ensurePreviewUser(db, {
    email: " Preview@Example.TEST ",
    displayName: "Preview User"
  });

  assert.equal(result.skipped, "");
  assert.equal(result.profile.email, "preview@example.test");
  assert.equal(result.profile.username, "preview");
  assert.equal(result.profile.authProvider, "jskit-preview");
  assert.equal(db.tables.users.length, 1);
  assert.equal(db.tables.user_settings.length, 1);
  assert.equal(db.tables.user_settings[0].theme, "system");
  assert.equal(db.tables.user_settings[0].password_sign_in_enabled, true);
});

test("ensurePreviewUser updates the existing preview row without stealing another username", async () => {
  const db = createMemoryDb({
    users: [
      {
        id: "1",
        auth_provider: "supabase",
        auth_provider_user_sid: "other",
        email: "taken@example.test",
        username: "preview",
        display_name: "Other"
      },
      {
        id: "2",
        auth_provider: "jskit-preview",
        auth_provider_user_sid: "jskit-preview:preview@example.test",
        email: "preview@example.test",
        username: "old-preview",
        display_name: "Old"
      }
    ],
    user_settings: [
      {
        user_id: "2"
      }
    ]
  });

  const result = await ensurePreviewUser(db, {
    email: "preview@example.test",
    username: "preview",
    displayName: "New Preview"
  });

  assert.equal(result.profile.id, "2");
  assert.equal(result.profile.username, "preview-2");
  assert.equal(db.tables.users.find((row) => row.id === "2").display_name, "New Preview");
  assert.equal(db.tables.user_settings.length, 1);
});

test("ensurePreviewUser skips when the users table is absent", async () => {
  const db = createMemoryDb({});

  const result = await ensurePreviewUser(db, {
    email: "preview@example.test"
  });

  assert.deepEqual(result, {
    user: null,
    profile: null,
    skipped: "users table was not found"
  });
});
