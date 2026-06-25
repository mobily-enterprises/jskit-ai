import assert from "node:assert/strict";
import test from "node:test";
import { ensurePreviewWorkspace } from "../src/server/previewWorkspaceProvisioning.js";

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
    let order = null;

    return {
      where(nextCriteria = {}) {
        criteria = { ...criteria, ...nextCriteria };
        return this;
      },
      orderBy(column, direction = "asc") {
        order = { column, direction };
        return this;
      },
      async first() {
        const found = rows.filter((row) => matches(row, criteria));
        if (order) {
          found.sort((left, right) => {
            const leftValue = Number(left[order.column]);
            const rightValue = Number(right[order.column]);
            const delta = Number.isFinite(leftValue) && Number.isFinite(rightValue)
              ? leftValue - rightValue
              : String(left[order.column] || "").localeCompare(String(right[order.column] || ""));
            return order.direction === "desc" ? delta * -1 : delta;
          });
        }
        return found[0] || null;
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

test("ensurePreviewWorkspace creates a personal workspace, owner membership, and settings", async () => {
  const db = createMemoryDb({
    workspaces: [],
    workspace_memberships: [],
    workspace_settings: []
  });

  const result = await ensurePreviewWorkspace(
    db,
    { id: "7" },
    { email: "preview@example.test", username: "preview", displayName: "Preview User" },
    { appConfig: { tenancyMode: "personal" } }
  );

  assert.equal(result.skipped, "");
  assert.deepEqual(result.workspace, {
    id: "1",
    slug: "preview"
  });
  assert.equal(db.tables.workspaces[0].is_personal, true);
  assert.equal(db.tables.workspace_memberships[0].role_sid, "owner");
  assert.equal(db.tables.workspace_memberships[0].status, "active");
  assert.equal(db.tables.workspace_settings[0].light_primary_color, "#1867C0");
});

test("ensurePreviewWorkspace repairs an existing owner membership", async () => {
  const db = createMemoryDb({
    workspaces: [
      {
        id: "3",
        slug: "preview",
        owner_user_id: "7",
        is_personal: true,
        name: "Preview",
        avatar_url: ""
      }
    ],
    workspace_memberships: [
      {
        id: "9",
        workspace_id: "3",
        user_id: "7",
        role_sid: "member",
        status: "inactive"
      }
    ],
    workspace_settings: []
  });

  const result = await ensurePreviewWorkspace(
    db,
    { id: "7" },
    { email: "preview@example.test", username: "preview" },
    { appConfig: { tenancyMode: "personal" } }
  );

  assert.equal(result.workspace.id, "3");
  assert.equal(db.tables.workspace_memberships[0].role_sid, "owner");
  assert.equal(db.tables.workspace_memberships[0].status, "active");
  assert.equal(db.tables.workspace_settings.length, 1);
});

test("ensurePreviewWorkspace skips when workspace tenancy is disabled", async () => {
  const db = createMemoryDb({
    workspaces: [],
    workspace_memberships: [],
    workspace_settings: []
  });

  const result = await ensurePreviewWorkspace(
    db,
    { id: "7" },
    { email: "preview@example.test" },
    { appConfig: { tenancyMode: "none" } }
  );

  assert.deepEqual(result, {
    workspace: null,
    skipped: "workspace tenancy is disabled"
  });
});
