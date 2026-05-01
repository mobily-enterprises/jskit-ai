import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runGeneratorSubcommand } from "../src/server/subcommands/addField.js";

const RESOURCE_SOURCE = `import { defineCrudResource } from "@jskit-ai/crud-core/shared/crudResource";

const resource = defineCrudResource({
  namespace: "contacts",
  tableName: "contacts",
  schema: {
    firstName: {
      type: "string",
      nullable: true,
      maxLength: 160,
      operations: {
        output: { required: true },
        create: { required: false },
        patch: { required: false }
      }
    }
  },
  contract: {
    lookup: {
      containerKey: "lookups"
    }
  }
});

export { resource };
`;

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "crud-server-scaffold-field-"));
  try {
    await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

async function writeAppFile(appRoot, relativePath, source) {
  const absolutePath = path.join(appRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, source, "utf8");
  return absolutePath;
}

function createSnapshot() {
  return {
    tableName: "contacts",
    idColumn: "id",
    columns: [
      { name: "id", key: "id", typeKind: "integer", nullable: false, unsigned: true },
      { name: "workspace_id", key: "workspaceId", typeKind: "integer", nullable: true, unsigned: true },
      { name: "user_id", key: "userId", typeKind: "integer", nullable: true, unsigned: true },
      { name: "created_at", key: "createdAt", typeKind: "datetime", nullable: false },
      { name: "updated_at", key: "updatedAt", typeKind: "datetime", nullable: false },
      { name: "first_name", key: "firstName", typeKind: "string", nullable: true, maxLength: 160 },
      { name: "category_id", key: "categoryId", typeKind: "integer", nullable: true, unsigned: true }
    ],
    foreignKeys: [
      {
        name: "contacts_category_id_foreign",
        referencedTableName: "customer_categories",
        columns: [
          {
            name: "category_id",
            referencedName: "id"
          }
        ]
      }
    ]
  };
}

test("scaffold-field patches CRUD resource file using DB snapshot metadata", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/contacts/src/shared/contactResource.js";
    await writeAppFile(appRoot, resourceFile, RESOURCE_SOURCE);

    const result = await runGeneratorSubcommand({
      appRoot,
      subcommand: "scaffold-field",
      args: ["categoryId", resourceFile],
      options: {},
      resolveSnapshot: async () => createSnapshot()
    });

    assert.deepEqual(result.touchedFiles, [resourceFile]);

    const content = await readFile(path.join(appRoot, resourceFile), "utf8");
    assert.match(content, /categoryId: \{/);
    assert.match(content, /type: "id"/);
    assert.match(content, /nullable: true/);
    assert.match(content, /operations: \{/);
    assert.match(content, /create: \{ required: false \}/);
    assert.match(content, /patch: \{ required: false \}/);
    assert.match(content, /relation: \{ kind: "lookup", namespace: "customer-categories", valueKey: "id" \}/);
    assert.match(content, /ui: \{ formControl: "autocomplete" \}/);
    assert.doesNotMatch(content, /normalizeIfInSource|normalizeIfPresent|normalizeOrNull|normalizeRecordId/);

    const secondRun = await runGeneratorSubcommand({
      appRoot,
      subcommand: "scaffold-field",
      args: ["categoryId", resourceFile],
      options: {},
      resolveSnapshot: async () => createSnapshot()
    });
    assert.deepEqual(secondRun.touchedFiles, []);
  });
});
