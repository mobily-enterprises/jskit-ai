import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runGeneratorSubcommand } from "../src/server/subcommands/addField.js";

const RESOURCE_SOURCE = `import { createSchema } from "json-rest-schema";
import { createCursorListValidator, RECORD_ID_PATTERN } from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const RESOURCE_LOOKUP_CONTAINER_KEY = "lookups";

const recordOutputSchema = createSchema({
  id: {
    type: "string",
    required: true,
    minLength: 1,
    pattern: RECORD_ID_PATTERN
  },
  firstName: {
    type: "string",
    required: true,
    nullable: true,
    maxLength: 160
  },
  [RESOURCE_LOOKUP_CONTAINER_KEY]: {
    type: "object",
    required: false
  }
});

const createBodySchema = createSchema({
  firstName: {
    type: "string",
    required: false,
    nullable: true,
    maxLength: 160
  }
});

const patchBodySchema = createSchema({
  firstName: {
    type: "string",
    required: false,
    nullable: true,
    maxLength: 160
  }
});

const recordOutputValidator = deepFreeze({
  schema: recordOutputSchema,
  mode: "replace"
});

const createBodyValidator = deepFreeze({
  schema: createBodySchema,
  mode: "create"
});

const patchBodyValidator = deepFreeze({
  schema: patchBodySchema,
  mode: "patch"
});

const resource = deepFreeze({
  namespace: "contacts",
  tableName: "contacts",
  idColumn: "id",
  operations: {
    list: { method: "GET", output: createCursorListValidator(recordOutputValidator) },
    view: { method: "GET", output: recordOutputValidator },
    create: { method: "POST", body: createBodyValidator, output: recordOutputValidator },
    patch: { method: "PATCH", body: patchBodyValidator, output: recordOutputValidator }
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
    assert.match(content, /type: "string"/);
    assert.match(content, /pattern: RECORD_ID_PATTERN/);
    assert.match(content, /type: "id"/);
    assert.match(content, /nullable: true/);
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
