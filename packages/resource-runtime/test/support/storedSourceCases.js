import assert from "node:assert/strict";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { countQueries } from "@jskit-ai/database-runtime/server/testDatabases";
import { passedOn, resolveWorkspaceScopeValue } from "../../src/server/index.js";
import { createTestResourceRuntime } from "../../src/test/index.js";

// A row policy that reads another owner's rows as stored, on every database the runtime supports: the folders' owner
// answers its folders to the documents' policy through a join source under its own system scope, narrowed to the call's
// workspace, so a document in an open folder is visible to a person who may not see the folder itself, and never
// through another workspace's folder. Each database's test file runs these cases on its own connection.

const asPerson = (userId, workspaceId = "1") => ({ context: { actor: { id: userId }, workspace: { id: workspaceId } } });

const folderResource = defineTableResource({
  name: "folders",
  tableName: "folders",
  ownership: "workspace",
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    createdBy: { type: "string", required: true, storage: { column: "created_by" } },
    status: { type: "string", required: true }
  }
});
const documentResource = defineTableResource({
  name: "documents",
  tableName: "documents",
  ownership: "workspace",
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    folderId: { type: "id", required: true, storage: { column: "folder_id" } },
    title: { type: "string", required: true }
  }
});

/**
 * Workspace 1's folders 1 (open, made by person 2) and 2 (closed, made by person 1), workspace 2's folder 3 (open);
 * `count` documents in each folder of workspace 1 and, in workspace 1, as many naming workspace 2's folder.
 */
async function foldersAndDocuments(knex, count) {
  await knex.schema.createTable("folders", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable().index();
    table.string("created_by").notNullable();
    table.string("status").notNullable();
  });
  await knex.schema.createTable("documents", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable().index();
    table.integer("folder_id").notNullable().index();
    table.string("title").notNullable();
  });
  await knex("folders").insert([
    { workspace_id: 1, created_by: "2", status: "open" },
    { workspace_id: 1, created_by: "1", status: "closed" },
    { workspace_id: 2, created_by: "2", status: "open" }
  ]);
  const documents = [1, 2, 3].flatMap((folderId) => Array.from({ length: count }, (_, index) => ({
    workspace_id: 1, folder_id: folderId, title: `${folderId}-${String(index).padStart(3, "0")}`
  })));
  for (let start = 0; start < documents.length; start += 200) {
    await knex("documents").insert(documents.slice(start, start + 200));
  }
  const runtime = await createTestResourceRuntime({ knex });
  // A person sees the folders they made; background work sees its scope's.
  const { folders } = await runtime.own("folders.feature", [{
    resource: folderResource,
    rowPolicy: ({ query, caller, column, value }) => {
      if (caller.kind === "user") query.where(column("createdBy"), value("createdBy", caller.userId));
      return caller.kind !== "anonymous";
    }
  }]);
  const systemContext = runtime.declareSystemScope("folders.feature", "answer folders as stored to the documents' row policy");
  // The folders' owner API: its folders as stored, in the caller's workspace, for another owner's row policy.
  const folderStatuses = {
    storedSource({ alias }, options) {
      const context = systemContext("the documents' row policy reads each folder's status as stored")
        .forWorkspace(resolveWorkspaceScopeValue(options.context));
      return folders.joinSource({ alias }, { ...passedOn(options), context });
    }
  };
  // A person sees the documents of the open folders, as stored: a folder they may not see counts too.
  const { documents: documentsHandle } = await runtime.own("documents.feature", [{
    resource: documentResource,
    rowPolicy: async ({ query, caller, column, options, requires }) => {
      if (caller.kind !== "user") return caller.kind !== "anonymous";
      const folder = await requires.folders.storedSource({ alias: "f" }, options);
      query.whereExists(folder.query.select(1).whereColumn(folder.column("id"), column("folderId")).where(folder.column("status"), "open"));
      return true;
    }
  }], { requires: { folders: folderStatuses } });
  return { folders, documents: documentsHandle };
}

/**
 * @param {(t: import("node:test").TestContext, suffix: string) => Promise<import("knex").Knex>} connect
 *   The test's own empty database; `suffix` names it where the database needs a name.
 */
function storedSourceCases(connect) {
  return [
    ["a row policy reads another owner's rows as stored in the call's workspace, and a page of them costs one statement among 3 and 300 documents", async (t) => {
      const costs = [];
      for (const count of [3, 300]) {
        const knex = await connect(t, `da_ss_${count}`);
        const { folders, documents } = await foldersAndDocuments(knex, count);
        // Person 1 sees folder 2 only, yet the documents of folder 1, which is open; never those naming workspace 2's
        // open folder 3, and never the closed folder 2's.
        assert.deepEqual((await folders.queryAll({}, asPerson("1"))).map(({ id }) => id), ["2"]);
        const { result, count: statements } = await countQueries(knex, () => documents.queryAll({ take: 20 }, asPerson("1")));
        assert.equal(result.length, Math.min(count, 20));
        assert.deepEqual([...new Set(result.map(({ folderId }) => String(folderId)))], ["1"]);
        // In a transaction the stored read joins the caller's.
        const inTransaction = await documents.withTransaction(asPerson("1"), (tx) => documents.queryAll({ take: 1 }, tx));
        assert.deepEqual(inTransaction.map(({ folderId }) => String(folderId)), ["1"]);
        costs.push(statements);
      }
      assert.deepEqual(costs, [1, 1]);
    }]
  ];
}

export { storedSourceCases };
