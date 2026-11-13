import assert from "node:assert/strict";
import { defineFeature } from "@jskit-ai/kernel/server/features";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { countQueries } from "@jskit-ai/database-runtime/server/testDatabases";
import { startTestFeatures } from "../../src/test/index.js";

// A ring a row policy closes, on every database the runtime supports: the audit history's row policy narrows through
// the evidence owner's join source, while the evidence owner records each change in the audit history. The audit
// feature late-requires the evidence's owner API, so the kernel starts the ring and resolves it once every feature has
// booted, and the policy reads it at call time. Each database's test file runs these cases on its own connection.

const evidenceFileResource = defineTableResource({
  name: "evidenceFiles",
  tableName: "evidence_files",
  ownership: "workspace",
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    name: { type: "string", required: true },
    withdrawn: { type: "boolean", defaultTo: false }
  }
});

const auditEntryResource = defineTableResource({
  name: "auditEntries",
  tableName: "audit_entries",
  ownership: "workspace",
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    evidenceFileId: { type: "id", required: true, storage: { column: "evidence_file_id" } },
    action: { type: "string", required: true }
  }
});

// A person sees an audit entry only while they see its evidence file, as the evidence owner's join source answers it.
async function auditEntriesPolicy({ query, caller, column, options, requires }) {
  if (caller.kind !== "user") {
    return caller.kind !== "anonymous";
  }
  const file = await requires.evidence.joinSource({ alias: "ef" }, options);
  query.whereExists(file.query.select(1).whereColumn(file.column("id"), column("evidenceFileId")));
  return true;
}

// A person does not see a withdrawn evidence file.
function evidenceFilesPolicy({ query, caller, column }) {
  if (caller.kind === "user") {
    query.where(column("withdrawn"), false);
  }
  return true;
}

/**
 * The audit and evidence features. With `plainRing`, the audit feature requires the evidence's owner API as a plain
 * requirement instead of a late one.
 * @param {{ plainRing?: boolean }} [options]
 */
function auditAndEvidence({ plainRing = false } = {}) {
  const evidenceRequirement = { evidence: "evidence.files" };
  const AuditFeature = defineFeature({
    id: "audit",
    owns: [{ resource: auditEntryResource, rowPolicy: auditEntriesPolicy }],
    ...(plainRing ? { requires: evidenceRequirement } : { late: evidenceRequirement }),
    provides: { history: "audit.history" },
    setup: ({ resources }) => ({
      history: Object.freeze({
        record: (entry, options) => resources.auditEntries.create(entry, { ...options, returning: "none" }),
        actions: async (options) => (await resources.auditEntries.queryAll({ sort: ["id"] }, options)).map(({ action }) => action)
      })
    })
  });
  const EvidenceFeature = defineFeature({
    id: "evidence",
    owns: [{ resource: evidenceFileResource, rowPolicy: evidenceFilesPolicy }],
    systemScope: "file and withdraw evidence for a test's workspaces",
    requires: { history: "audit.history" },
    provides: { files: "evidence.files" },
    setup: ({ resources, systemContext, history }) => {
      const inWorkspace = (workspaceId) => ({ context: systemContext("file evidence").forWorkspace(workspaceId) });
      return {
        files: Object.freeze({
          async add(name, workspaceId) {
            const id = await resources.evidenceFiles.create({ name }, { ...inWorkspace(workspaceId), returning: "id" });
            await history.record({ evidenceFileId: id, action: `added ${name}` }, inWorkspace(workspaceId));
            return id;
          },
          async withdraw(id, name, workspaceId) {
            await resources.evidenceFiles.patch(id, { withdrawn: true }, { ...inWorkspace(workspaceId), returning: "none" });
            await history.record({ evidenceFileId: id, action: `withdrew ${name}` }, inWorkspace(workspaceId));
          },
          joinSource: (request, options) => resources.evidenceFiles.joinSource(request, options)
        })
      };
    }
  });
  return [AuditFeature, EvidenceFeature];
}

async function createTables(knex) {
  await knex.schema.createTable("evidence_files", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable().index();
    table.string("name").notNullable();
    table.boolean("withdrawn").notNullable().defaultTo(false);
  });
  await knex.schema.createTable("audit_entries", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable().index();
    table.integer("evidence_file_id").notNullable().index();
    table.string("action").notNullable();
  });
}

const asPerson = (userId, workspaceId) => ({ context: { actor: { id: userId }, workspace: { id: workspaceId } } });

/**
 * @param {(t: import("node:test").TestContext, suffix: string) => Promise<import("knex").Knex>} connect
 *   The test's own empty database; `suffix` names it where the database needs a name.
 */
function lateRequiresCases(connect) {
  return [
    ["a row policy that narrows through an owner which requires its own feature starts with a late requirement, and reads only the rows the policy admits", async (t) => {
      const knex = await connect(t, "rr_late_ring");
      await createTables(knex);

      // The same ring with a plain requirement is refused before any setup.
      await assert.rejects(
        startTestFeatures({ knex, features: auditAndEvidence({ plainRing: true }) }),
        { message: "Provider capability cycle detected: audit -> evidence -> audit." }
      );

      const { capabilities, resources, stop } = await startTestFeatures({
        knex,
        features: auditAndEvidence(),
        requires: { files: "evidence.files", history: "audit.history" }
      });
      t.after(stop);
      const { files, history } = capabilities;
      await files.add("contract.pdf", "1");
      const photo = await files.add("photo.jpg", "1");
      await files.withdraw(photo, "photo.jpg", "1");
      await files.add("invoice.pdf", "2");

      // A person in workspace 1 sees the contract's entry, not the withdrawn photo's two, in the read's one statement.
      const read = await countQueries(knex, () => history.actions(asPerson("7", "1")));
      assert.deepEqual([read.result, read.count], [["added contract.pdf"], 1]);
      assert.deepEqual(await history.actions(asPerson("8", "2")), ["added invoice.pdf"]);
      // Background work in workspace 1 sees every entry of its workspace.
      const job = { context: resources.declareSystemScope("test.reader", "check a test's audit entries")("check").forWorkspace("1") };
      assert.deepEqual(await history.actions(job), ["added contract.pdf", "added photo.jpg", "withdrew photo.jpg"]);
    }]
  ];
}

export { lateRequiresCases };
