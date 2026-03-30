import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runGeneratorSubcommand } from "../src/server/subcommands/addField.js";

const RESOURCE_SOURCE = `import { Type } from "typebox";
import { normalizeObjectInput, createCursorListValidator } from "@jskit-ai/kernel/shared/validators";
import { normalizeText, normalizeIfInSource, normalizeIfPresent, normalizeOrNull } from "@jskit-ai/kernel/shared/support/normalize";

const RESOURCE_LOOKUP_CONTAINER_KEY = "lookups";

const recordOutputSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    firstName: Type.Union([Type.String(), Type.Null()]),
    [RESOURCE_LOOKUP_CONTAINER_KEY]: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
  },
  { additionalProperties: false }
);

const createBodySchema = Type.Object(
  {
    firstName: Type.Union([Type.String({ maxLength: 160 }), Type.Null()])
  },
  {
    additionalProperties: false,
    required: []
  }
);

const patchBodySchema = Type.Partial(createBodySchema, { additionalProperties: false });

const recordOutputValidator = Object.freeze({
  schema: recordOutputSchema,
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);
    const normalized = {
      id: normalizeIfPresent(source.id, Number),
      firstName: normalizeOrNull(source.firstName, normalizeText)
    };
    const sourceLookupContainer = source[RESOURCE_LOOKUP_CONTAINER_KEY];
    if (sourceLookupContainer && typeof sourceLookupContainer === "object" && !Array.isArray(sourceLookupContainer)) {
      normalized[RESOURCE_LOOKUP_CONTAINER_KEY] = sourceLookupContainer;
    }
    return normalized;
  }
});

const listOutputValidator = createCursorListValidator(recordOutputValidator);

const createBodyValidator = Object.freeze({
  schema: createBodySchema,
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);
    const normalized = {};

    normalizeIfInSource(source, normalized, "firstName", normalizeText);

    return normalized;
  }
});

const patchBodyValidator = Object.freeze({
  schema: patchBodySchema,
  normalize: createBodyValidator.normalize
});

const RESOURCE_FIELD_META = [];

const contactResource = {
  resource: "contacts",
  tableName: "contacts",
  idColumn: "id",
  operations: {
    list: { method: "GET", outputValidator: listOutputValidator },
    view: { method: "GET", outputValidator: recordOutputValidator },
    create: { method: "POST", bodyValidator: createBodyValidator, outputValidator: recordOutputValidator },
    patch: { method: "PATCH", bodyValidator: patchBodyValidator, outputValidator: recordOutputValidator }
  },
  fieldMeta: RESOURCE_FIELD_META
};

export { contactResource };
`;

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "crud-server-add-field-"));
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
      { name: "workspace_owner_id", key: "workspaceOwnerId", typeKind: "integer", nullable: true, unsigned: true },
      { name: "user_owner_id", key: "userOwnerId", typeKind: "integer", nullable: true, unsigned: true },
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

test("add-field patches CRUD resource file using DB snapshot metadata", async () => {
  await withTempApp(async (appRoot) => {
    const resourceFile = "packages/contacts/src/shared/contactResource.js";
    await writeAppFile(appRoot, resourceFile, RESOURCE_SOURCE);

    const result = await runGeneratorSubcommand({
      appRoot,
      subcommand: "add-field",
      args: ["categoryId", resourceFile],
      options: {},
      resolveSnapshot: async () => createSnapshot()
    });

    assert.deepEqual(result.touchedFiles, [resourceFile]);

    const content = await readFile(path.join(appRoot, resourceFile), "utf8");
    assert.match(content, /categoryId: Type\.Union\(\[Type\.Integer\(\{ minimum: 0 \}\), Type\.Null\(\)\]\)/);
    assert.match(content, /normalizeIfInSource\(source, normalized, "categoryId", normalizeFiniteInteger\);/);
    assert.match(content, /categoryId: normalizeOrNull\(source\.categoryId, normalizeFiniteInteger\)/);
    assert.match(content, /RESOURCE_FIELD_META\.push\(\{/);
    assert.match(content, /key: "categoryId"/);
    assert.match(content, /namespace: "customer-categories"/);
    assert.match(content, /valueKey: "id"/);
    assert.match(content, /formControl: "autocomplete" \/\/ or "select"/);
    assert.match(content, /normalizeFiniteInteger/);

    const secondRun = await runGeneratorSubcommand({
      appRoot,
      subcommand: "add-field",
      args: ["categoryId", resourceFile],
      options: {},
      resolveSnapshot: async () => createSnapshot()
    });
    assert.deepEqual(secondRun.touchedFiles, []);
  });
});
