import assert from "node:assert/strict";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { createTestResourceRuntime } from "../../src/test/index.js";

// A lock decides which rows its caller may lock from the rows its row policy reads as last committed: every subquery
// of the policy (here ownTable reads of a membership and a grant) takes a shared lock in lock(), lockMany(),
// lockWhere() and lockPages(). On MySQL and MariaDB a plain subquery inside a transaction that has already read
// plainly answers from that read's snapshot, and on PostgreSQL a lock that waited for its row rechecked it against
// the policy's rows as they were when the statement began. Each database's test file runs these cases on its own
// connection.

const ADA = "7";
const asAda = Object.freeze({ context: Object.freeze({ actor: Object.freeze({ id: ADA }), workspace: Object.freeze({ id: "1" }) }) });

const memberResource = defineTableResource({
  name: "members",
  tableName: "lp_members",
  ownership: "workspace",
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    userId: { type: "string", required: true, storage: { column: "user_id" } }
  }
});
const grantResource = defineTableResource({
  name: "grants",
  tableName: "lp_grants",
  ownership: "workspace",
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    userId: { type: "string", required: true, storage: { column: "user_id" } },
    projectId: { type: "integer", required: true, storage: { column: "project_id" } }
  }
});
const projectResource = defineTableResource({
  name: "projects",
  tableName: "lp_projects",
  ownership: "workspace",
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    name: { type: "string", required: true, search: true }
  }
});

// A member of the project's workspace with a grant of the project itself.
function memberWithGrant({ query, caller, column, ownTable }) {
  if (caller.kind !== "user") {
    return caller.kind !== "anonymous";
  }
  query.whereExists(ownTable("members").select(1)
    .whereColumn("lp_members.workspace_id", column("workspaceId"))
    .where("lp_members.user_id", caller.userId));
  query.whereIn(column("id"), ownTable("grants").select("project_id").where("lp_grants.user_id", caller.userId));
  return true;
}

/**
 * Projects 1 to 3 of workspace 1; Ada (7) is its member and holds a grant of project 1.
 * `reset()` puts those rows back.
 * @param {import("knex").Knex} knex
 */
async function projectsOf(knex) {
  await knex.schema.createTable("lp_members", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.string("user_id").notNullable();
    table.unique(["workspace_id", "user_id"]);
  });
  await knex.schema.createTable("lp_grants", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.string("user_id").notNullable();
    table.integer("project_id").notNullable();
    table.index(["user_id", "project_id"]);
  });
  await knex.schema.createTable("lp_projects", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.string("name").notNullable();
    // An index that reads a workspace's rows in id order, which lockWhere and lockPages need on MySQL and MariaDB.
    table.index(["workspace_id"], "lp_projects_workspace");
  });
  const runtime = await createTestResourceRuntime({ knex });
  const { projects } = await runtime.own("projects.feature", [memberResource, grantResource, { resource: projectResource, rowPolicy: memberWithGrant }]);
  const reset = async () => {
    for (const table of ["lp_grants", "lp_members", "lp_projects"]) {
      await knex(table).del();
    }
    await knex("lp_projects").insert([1, 2, 3].map((id) => ({ id, workspace_id: 1, name: `P${id}` })));
    await knex("lp_members").insert({ id: 1, workspace_id: 1, user_id: ADA });
    await knex("lp_grants").insert({ id: 1, workspace_id: 1, user_id: ADA, project_id: 1 });
  };
  await reset();
  return { projects, reset };
}

/** Each lock method's lock of Ada's rows among projects 1 to 3, as the names it answers. */
const LOCKS = {
  lockMany: (projects, tx) => projects.lockMany(["1", "2", "3"], { ...tx, missing: "skip", fields: ["name"] }),
  lockWhere: (projects, tx) => projects.lockWhere({}, { ...tx, fields: ["name"] }),
  lockPages: async (projects, tx) => {
    const records = [];
    for await (const page of projects.lockPages({}, { ...tx, pageSize: 2, fields: ["name"] })) {
      records.push(...page);
    }
    return records;
  }
};
const namesOf = (records) => records.map(({ name }) => name).sort();

// What another transaction commits, and what Ada's lock must then answer.
const CHANGES = {
  "her membership revoked": { write: (db) => db("lp_members").where({ id: 1 }).del(), names: [] },
  "her grant revoked": { write: (db) => db("lp_grants").where({ id: 1 }).del(), names: [] },
  "a grant of project 2 added": { write: (db) => db("lp_grants").insert({ id: 2, workspace_id: 1, user_id: ADA, project_id: 2 }), names: ["P1", "P2"] },
  "her grant moved to project 2": { write: (db) => db("lp_grants").where({ id: 1 }).update({ project_id: 2 }), names: ["P2"] }
};

/** PostgreSQL's id of the connection a transaction holds; MySQL and MariaDB need none (see lockWaitOf). */
async function backendOf(trx) {
  return trx.client.config.client === "pg" ? (await trx.raw("SELECT pg_backend_pid() AS id")).rows[0].id : null;
}

/**
 * Resolves once the lock waits for the writer; fails at once if `waiter` ends first. PostgreSQL shows the wait of
 * backend `id` in pg_stat_activity. MySQL and MariaDB show a lock wait only to a user with the PROCESS privilege,
 * which a test database's user may lack, so there the lock must still run after 300 ms: a lock that waits for nothing
 * answers in milliseconds, and what it answers once the writer commits is checked either way.
 * @param {import("knex").Knex} knex another connection's Knex
 * @param {number | null} id
 * @param {Promise<unknown>} waiter
 */
async function lockWaitOf(knex, id, waiter) {
  let outcome;
  waiter.then(() => {
    outcome = "answered without waiting for a lock";
  }, (error) => {
    outcome = `failed before it waited: ${error.message}`;
  });
  const running = () => {
    if (outcome) {
      assert.fail(`the lock ${outcome}`);
    }
  };
  if (id === null) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    running();
    return;
  }
  for (const deadline = Date.now() + 5000; Date.now() < deadline;) {
    running();
    const { rows: [{ waiting }] } = await knex.raw("SELECT COUNT(*)::int AS waiting FROM pg_stat_activity WHERE pid = ? AND wait_event_type = 'Lock'", [id]);
    if (waiting > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("the lock never waited for the writer");
}

/**
 * @param {(t: import("node:test").TestContext, suffix: string) => Promise<import("knex").Knex>} connect
 *   The test's own empty database; `suffix` names it where the database needs a name.
 */
function lockPolicyCases(connect) {
  const needsTwoConnections = async (t, suffix) => {
    const knex = await connect(t, suffix);
    if (knex.client.config.client === "better-sqlite3") {
      t.skip("SQLite has one writer, so no other transaction commits while a lock's is open");
      return null;
    }
    return knex;
  };

  const cases = [
    ["a lock's row policy subqueries take a shared lock on MySQL, MariaDB and PostgreSQL, and none on SQLite", async (t) => {
      const knex = await connect(t, "da_lp_sql");
      const { projects } = await projectsOf(knex);
      const client = knex.client.config.client;
      const clause = client === "pg" ? / for share\)/giu : / lock in share mode\)/giu;
      for (const [method, lock] of Object.entries(LOCKS)) {
        const statements = [];
        const record = ({ sql }) => statements.push(sql);
        knex.on("query", record);
        try {
          assert.deepEqual(namesOf(await projects.withTransaction(asAda, (tx) => lock(projects, tx))), ["P1"], method);
        } finally {
          knex.removeListener("query", record);
        }
        const locking = statements.filter((sql) => sql.includes("lp_members"));
        assert.ok(locking.length > 0, method);
        for (const sql of locking) {
          // The membership's and the grant's subqueries; SQLite has no row locks, so nothing changes there.
          assert.equal(sql.match(clause)?.length ?? 0, client === "better-sqlite3" ? 0 : 2, `${method}: ${sql}`);
        }
      }
    }]
  ];

  for (const [method, lock] of Object.entries(LOCKS)) {
    cases.push([`${method} decides from the membership and grants other transactions committed after the transaction's first plain read`, async (t) => {
      const knex = await needsTwoConnections(t, `da_lp_read_${method.toLowerCase()}`);
      if (!knex) return;
      const { projects, reset } = await projectsOf(knex);
      for (const [change, { write, names }] of Object.entries(CHANGES)) {
        await reset();
        const locked = await projects.withTransaction(asAda, async (tx) => {
          // On MySQL and MariaDB this read fixes the transaction's REPEATABLE READ snapshot.
          assert.deepEqual(namesOf(await projects.queryAll({}, tx)), ["P1"], change);
          await write(knex);
          return lock(projects, tx);
        });
        assert.deepEqual(namesOf(locked), names, change);
      }
    }]);

    cases.push([`${method} waits for a writer of the policy's rows, then decides from what it committed`, async (t) => {
      const knex = await needsTwoConnections(t, `da_lp_wait_${method.toLowerCase()}`);
      if (!knex) return;
      const { projects, reset } = await projectsOf(knex);
      const writers = {
        // One that holds project 1 itself: the lock waits for its row, then must not recheck it against the old grant.
        "holds project 1 and revokes her grant": async (db) => {
          await db("lp_projects").where({ id: 1 }).update({ name: "P1 renamed" });
          await db("lp_grants").where({ id: 1 }).del();
        },
        // One that touches no row the lock takes: the lock waits only because its subquery locks the membership.
        "revokes her membership": (db) => db("lp_members").where({ id: 1 }).del()
      };
      for (const [writes, write] of Object.entries(writers)) {
        await reset();
        const writer = await knex.transaction();
        try {
          await write(writer);
          const locked = await projects.withTransaction({ ...asAda, retry: false }, async (tx) => {
            assert.deepEqual(namesOf(await projects.queryAll({}, tx)), ["P1"], writes);
            const id = await backendOf(tx.trx);
            const waiting = lock(projects, tx);
            try {
              await lockWaitOf(knex, id, waiting);
            } finally {
              // Also when the lock never waited, so a lock still running ends rather than waits for the writer.
              await writer.commit();
            }
            return waiting;
          });
          assert.deepEqual(namesOf(locked), [], writes);
        } finally {
          if (!writer.isCompleted()) await writer.rollback();
        }
      }
    }]);
  }
  return cases;
}

export { lockPolicyCases };
