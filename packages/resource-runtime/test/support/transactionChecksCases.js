import assert from "node:assert/strict";
import { countQueries } from "@jskit-ai/database-runtime/server/testDatabases";
import { USER_EIGHT, USER_SEVEN, WORKSPACE_ONE, WORKSPACE_TWO, installModule, moduleFixture } from "./transactionChecksFixture.js";

// One transaction that installs modules links every row it writes to the users who wrote it and to the rows it wrote
// before. json-rest-api checks each link with a scoped read of the linked row's id, as it checks each link a response
// shows; within one transaction it answers a check from its own earlier check of the same row in the same scope, until
// the transaction sends something that could change the answer. Each database's test file runs these cases on its own
// connection.

// A check: a read of one table's ids and nothing else (on SQLite, the id in a CASE that keeps a large one exact).
const CHECK = /^select (?:distinct )?([^,*]*?) from ([`"])(\w+)\2 where /iu;

function checksOf(queries) {
  const checks = {};
  for (const sql of queries) {
    const [, selected, quote, table] = CHECK.exec(sql) || [];
    if (table && selected.includes(`${quote}${table}${quote}.${quote}id${quote}`)) {
      checks[table] = (checks[table] || 0) + 1;
    }
  }
  return checks;
}

// The refusal of a link to a row the caller cannot see, however the handle's errors wrap it.
function refusedLink(type, id) {
  const message = `Cannot create relationship to non-existent ${type} with id ${id}`;
  return (error) => {
    for (let cause = error; cause; cause = cause.cause) {
      if (cause.message === message) {
        return true;
      }
    }
    assert.fail(`expected "${message}", got: ${error?.message}`);
  };
}

/**
 * @param {(t: import("node:test").TestContext, suffix: string) => Promise<import("knex").Knex>} connect
 *   The test's own empty database; `suffix` names it where the database needs a name.
 */
function transactionChecksCases(connect) {
  return [
    ["a transaction installing 32 modules checks the users they name once, and each module's new rows as often as one module's", async (t) => {
      const knex = await connect(t, "tc_counts");
      const { handles } = await moduleFixture(knex);
      let installed = 0;
      const install = async (modules, { transactionEach = false } = {}) => {
        const inOne = (count) => handles.forms.withTransaction({ context: WORKSPACE_ONE }, async (tx) => {
          for (let index = 0; index < count; index += 1) {
            installed += 1;
            await installModule(handles, tx, { name: `module ${installed}`, author: "7", publisher: "8" });
          }
        });
        const { queries } = await countQueries(knex, async () => {
          for (const count of transactionEach ? Array(modules).fill(1) : [modules]) {
            await inOne(count);
          }
        });
        return { statements: queries.length, checks: checksOf(queries) };
      };
      const one = await install(1);
      const many = await install(32);
      const each = await install(32, { transactionEach: true });
      const counts = JSON.stringify({ one, many, each });
      // Every module names the same two users, its author and its publisher: one transaction checks each once.
      assert.equal(one.checks.users, 2, counts);
      assert.equal(many.checks.users, 2, counts);
      // A transaction per module checks them in each, as every write did before.
      assert.equal(each.checks.users, 32 * 2, counts);
      // A module's own new rows are checked as often in a big transaction as in a small one: the checks follow the
      // rows written, and a write to a table makes its next check read again.
      for (const table of ["forms", "form_versions", "modules", "module_versions"]) {
        assert.equal(many.checks[table], 32 * one.checks[table], `${table}: ${counts}`);
        assert.equal(each.checks[table], 32 * one.checks[table], `${table}: ${counts}`);
      }
      assert.deepEqual(Object.keys(many.checks).sort(), ["form_versions", "forms", "module_versions", "modules", "users"], counts);
      // So one transaction's statements are 32 modules' worth beside its BEGIN, its COMMIT and the users' two checks.
      const fixed = 2 + 2;
      assert.equal(many.statements - fixed, 32 * (one.statements - fixed), counts);
    }],

    ["a transaction checks a row again once it removes the row, moves it out of the caller's scope or changes what hides it", async (t) => {
      const knex = await connect(t, "tc_changes");
      const { handles } = await moduleFixture(knex);
      const { drafts, formVersions, forms, memberships } = handles;
      // User 8 leaves workspace 1 after a form named them.
      await assert.rejects(forms.withTransaction({ context: WORKSPACE_ONE }, async (tx) => {
        await forms.create({ name: "a", createdBy: "8" }, tx);
        const membership = (await memberships.queryAll({}, tx)).find(({ userId }) => String(userId) === "8");
        await memberships.delete(membership.id, tx);
        await forms.create({ name: "b", createdBy: "8" }, tx);
      }), refusedLink("users", "8"));
      // The transaction moves a form to workspace 2 by a statement of its own, after a version linked it.
      let formId;
      await assert.rejects(forms.withTransaction({ context: WORKSPACE_ONE }, async (tx) => {
        formId = (await forms.create({ name: "c", createdBy: "7" }, tx)).id;
        await formVersions.create({ formId, status: "draft", createdBy: "7" }, tx);
        await tx.trx("forms").where({ id: formId }).update({ workspace_id: 2 });
        await formVersions.create({ formId, status: "draft", createdBy: "7" }, tx);
      }), (error) => refusedLink("forms", formId)(error));
      // The transaction deletes a draft a form linked.
      let draftId;
      await assert.rejects(forms.withTransaction({ context: USER_SEVEN }, async (tx) => {
        draftId = (await drafts.create({ title: "mine" }, tx)).id;
        const form = await forms.create({ name: "d", createdBy: "7", draftId }, tx);
        await forms.delete(form.id, tx);
        await drafts.delete(draftId, tx);
        await forms.create({ name: "e", createdBy: "7", draftId }, tx);
      }), (error) => refusedLink("drafts", draftId)(error));
      assert.deepEqual(await knex("forms").select("name"), []);
    }],

    ["a check made for one workspace or user never answers another's in the same transaction", async (t) => {
      const knex = await connect(t, "tc_scopes");
      const { handles } = await moduleFixture(knex);
      const { drafts, forms } = handles;
      // User 7 is a member of workspace 1 only.
      await assert.rejects(forms.withTransaction({ context: WORKSPACE_ONE }, async (tx) => {
        await forms.create({ name: "a", createdBy: "7" }, tx);
        await forms.create({ name: "b", createdBy: "7" }, { context: WORKSPACE_TWO, trx: tx.trx });
      }), refusedLink("users", "7"));
      // A draft is its own user's.
      const draft = await drafts.create({ title: "mine" }, { context: USER_SEVEN });
      await assert.rejects(forms.withTransaction({ context: USER_SEVEN }, async (tx) => {
        await forms.create({ name: "c", createdBy: "7", draftId: draft.id }, tx);
        await forms.create({ name: "d", createdBy: "8", draftId: draft.id }, { context: USER_EIGHT, trx: tx.trx });
      }), refusedLink("drafts", draft.id));
      assert.deepEqual(await knex("forms").select("name"), []);
    }],

    ["each transaction checks again what an earlier one checked, whether it rolled back or committed", async (t) => {
      const knex = await connect(t, "tc_next");
      const { handles } = await moduleFixture(knex);
      const { forms } = handles;
      const rollBack = new Error("roll back");
      await assert.rejects(forms.withTransaction({ context: WORKSPACE_ONE }, async (tx) => {
        await forms.create({ name: "a", createdBy: "7" }, tx);
        throw rollBack;
      }), (error) => error === rollBack);
      await forms.withTransaction({ context: WORKSPACE_ONE }, (tx) => forms.create({ name: "b", createdBy: "8" }, tx));
      // Users 7 and 8 leave workspace 1, outside any transaction.
      await knex("memberships").whereIn("user_id", [7, 8]).delete();
      for (const userId of ["7", "8"]) {
        await assert.rejects(forms.withTransaction({ context: WORKSPACE_ONE }, (tx) => forms.create({ name: "c", createdBy: userId }, tx)),
          refusedLink("users", userId));
      }
      assert.deepEqual((await knex("forms").select("name")).map(({ name }) => name), ["b"]);
    }],

    ["every link refused before is refused in a transaction that checked other rows of the table: another workspace's user, a missing row, another user's draft", async (t) => {
      const knex = await connect(t, "tc_refusals");
      const { handles } = await moduleFixture(knex);
      const { drafts, forms } = handles;
      const mine = await drafts.create({ title: "mine" }, { context: USER_SEVEN });
      const theirs = await drafts.create({ title: "theirs" }, { context: USER_EIGHT });
      for (const [data, refusal] of [
        [{ createdBy: "9" }, refusedLink("users", "9")],
        [{ createdBy: "999" }, refusedLink("users", "999")],
        [{ createdBy: "7", draftId: theirs.id }, refusedLink("drafts", theirs.id)]
      ]) {
        await assert.rejects(forms.withTransaction({ context: USER_SEVEN }, async (tx) => {
          await forms.create({ name: "kept", createdBy: "7", draftId: mine.id }, tx);
          await forms.create({ name: "refused", ...data }, tx);
        }), refusal);
      }
      assert.deepEqual(await knex("forms").select("name"), []);
    }]
  ];
}

export { transactionChecksCases };
