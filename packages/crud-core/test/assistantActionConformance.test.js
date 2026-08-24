import assert from "node:assert/strict";
import test from "node:test";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import {
  createSchema,
  validateSchemaPayload
} from "@jskit-ai/kernel/shared/validators";
import { returnJsonApiDocument } from "@jskit-ai/http-runtime/shared";
import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";
import { createCrudJsonApiActions } from "../src/server/jsonApiModule/actions.js";

const BOOKINGS = Object.freeze([
  Object.freeze({ id: "41", petId: "7", summary: "Wash and trim" }),
  Object.freeze({ id: "42", petId: "8", summary: "Nail trim" })
]);
const PETS = Object.freeze({
  "7": Object.freeze({ id: "7", name: "Fido", species: "dog" }),
  "8": Object.freeze({ id: "8", name: "Mabel", species: "cat" })
});

function createBookingsResource() {
  return defineCrudResource({
    namespace: "bookings",
    tableName: "bookings",
    crudOperations: ["list", "view"],
    contract: {
      lookup: {
        containerKey: "lookups"
      }
    },
    schema: {
      petId: {
        type: "id",
        required: true,
        belongsTo: "pets",
        as: "pet",
        relation: {
          kind: "lookup",
          namespace: "pets",
          valueKey: "id",
          labelKey: "name"
        },
        operations: {
          output: { required: true }
        }
      },
      summary: {
        type: "string",
        required: true,
        operations: {
          output: { required: true }
        }
      }
    }
  });
}

function selectFields(source, selectedFields = null) {
  if (!Array.isArray(selectedFields)) {
    return { ...source };
  }
  return Object.fromEntries(
    selectedFields
      .filter((field) => Object.hasOwn(source, field))
      .map((field) => [field, source[field]])
  );
}

function createBookingDocument(query = {}) {
  const limit = Math.min(Number(query.limit) || BOOKINGS.length, BOOKINGS.length);
  const selectedBookings = query.fields?.bookings || null;
  const selectedPets = query.fields?.pets || null;
  const includesPet = String(query.include || "")
    .split(",")
    .map((entry) => entry.trim())
    .includes("pet");
  const rows = BOOKINGS.slice(0, limit);
  const data = rows.map((booking) => {
    const includePetLinkage = !selectedBookings || selectedBookings.includes("petId");
    return {
      type: "bookings",
      id: booking.id,
      attributes: selectFields({ summary: booking.summary }, selectedBookings),
      ...(includePetLinkage
        ? {
            relationships: {
              pet: {
                data: { type: "pets", id: booking.petId }
              }
            }
          }
        : {})
    };
  });
  const included = includesPet
    ? rows.map((booking) => ({
        type: "pets",
        id: booking.petId,
        attributes: selectFields({
          name: PETS[booking.petId].name,
          species: PETS[booking.petId].species
        }, selectedPets)
      }))
    : [];

  return {
    data,
    ...(included.length > 0 ? { included } : {}),
    meta: {
      page: {
        nextCursor: limit < BOOKINGS.length ? `after-${rows.at(-1)?.id}` : null
      }
    }
  };
}

function createFixture() {
  const resource = createBookingsResource();
  const calls = [];
  const service = {
    async queryDocuments(query, { context }) {
      calls.push({ query, context });
      return returnJsonApiDocument(createBookingDocument(query));
    },
    async getDocumentById() {
      return returnJsonApiDocument({ data: createBookingDocument().data[0] });
    }
  };
  const definitions = createCrudJsonApiActions({
    namespace: "bookings",
    resource,
    service,
    surface: "admin",
    operations: ["list", "view"],
    scopeInputValidator: Object.freeze({
      schema: createSchema({
        workspaceSlug: { type: "string", required: true }
      }),
      mode: "patch"
    }),
    scopeInputKeys: ["workspaceSlug"],
    permissionForOperation: () => ({
      require: "all",
      permissions: ["bookings.list"]
    })
  });
  const actions = createActionCatalogue();
  actions.register({
    contributorId: "test.generated-bookings",
    domain: "bookings",
    actions: definitions
  });
  const catalog = createServiceToolCatalog(actions, { maxDirectTools: 0 });
  const context = Object.freeze({
    actor: Object.freeze({ id: "user-7" }),
    permissions: Object.freeze(["bookings.list"]),
    surface: "admin",
    workspace: Object.freeze({ slug: "north-clinic" })
  });
  return { actions, calls, catalog, context, definitions, resource };
}

async function loadListContract(fixture, context = fixture.context) {
  const toolSet = fixture.catalog.resolveToolSet(context);
  const search = await fixture.catalog.executeToolCall({
    toolName: "assistant_action_search",
    argumentsText: JSON.stringify({ query: "bookings list" }),
    context,
    toolSet
  });
  const contract = await fixture.catalog.executeToolCall({
    toolName: "assistant_action_contract",
    argumentsText: JSON.stringify({ actionId: "crud.bookings.list", version: 1 }),
    context,
    toolSet
  });
  return { contract, search, toolSet };
}

async function executeList(fixture, toolSet, input, context = fixture.context) {
  return fixture.catalog.executeToolCall({
    toolName: "assistant_action_execute",
    argumentsText: JSON.stringify({
      actionId: "crud.bookings.list",
      version: 1,
      input
    }),
    context,
    toolSet
  });
}

function resolveLocalSchemaReference(schema, node) {
  const reference = node?.allOf?.[0]?.$ref;
  assert.match(reference || "", /^#\/definitions\//u);
  return schema.definitions[reference.slice("#/definitions/".length)];
}

test("generated CRUD list contracts conform through native assistant discovery and execution", async (t) => {
  const fixture = createFixture();
  const { contract, search, toolSet } = await loadListContract(fixture);
  const listDefinition = fixture.definitions.find((entry) => entry.id === "crud.bookings.list");

  assert.equal(search.ok, true);
  assert.deepEqual(search.result.items.map((entry) => entry.actionId), ["crud.bookings.list"]);
  assert.equal(contract.ok, true);
  assert.equal(contract.result.inputSchema.properties.include.type, "string");
  const fieldsetInputSchema = resolveLocalSchemaReference(
    contract.result.inputSchema,
    contract.result.inputSchema.properties.fields
  );
  assert.deepEqual(Object.keys(fieldsetInputSchema.properties), ["bookings", "pets"]);
  assert.equal(fieldsetInputSchema.additionalProperties, false);
  assert.deepEqual(fieldsetInputSchema.properties.bookings.items.enum, ["id", "petId", "summary"]);
  assert.equal(Object.hasOwn(fieldsetInputSchema.properties.pets.items, "enum"), false);
  assert.equal(Object.hasOwn(contract.result.inputSchema.properties, "workspaceSlug"), false);
  assert.match(contract.result.description, /include must be a comma-separated string/u);
  assert.match(contract.result.description, /\{"bookings":\["petId"\],"pets":\["name"\]\}/u);
  assert.match(contract.result.description, /fields keys must be JSON:API resource types: "bookings", "pets"/u);
  assert.match(contract.result.description, /use "pets" instead of "pet"/u);
  assert.match(
    contract.result.description,
    /"pet" -> resource type "pets" -> items\[\]\.lookups\.pet/u
  );
  const primaryOutputSchema = resolveLocalSchemaReference(
    contract.result.outputSchema,
    contract.result.outputSchema.properties.items.items
  );
  const lookupOutputSchema = resolveLocalSchemaReference(
    contract.result.outputSchema,
    primaryOutputSchema.properties.lookups
  );
  const petOutputSchema = resolveLocalSchemaReference(
    contract.result.outputSchema,
    lookupOutputSchema.properties.pet
  );
  assert.ok(petOutputSchema.properties.name.anyOf.some((entry) => entry.type === "string"));

  await t.test("full list without fields or include", async () => {
    const response = await executeList(fixture, toolSet, { limit: 5 });
    assert.equal(response.ok, true);
    assert.deepEqual(response.result.result.items, [
      { id: "41", petId: 7, summary: "Wash and trim" },
      { id: "42", petId: 8, summary: "Nail trim" }
    ]);
    assert.equal(response.result.result.nextCursor, null);
  });

  await t.test("sparse primary fields only", async () => {
    const response = await executeList(fixture, toolSet, {
      fields: { bookings: ["petId"] },
      limit: 5
    });
    assert.equal(response.ok, true);
    assert.deepEqual(response.result.result.items, [
      { id: "41", petId: 7 },
      { id: "42", petId: 8 }
    ]);
  });

  await t.test("included relationship without sparse fields", async () => {
    const response = await executeList(fixture, toolSet, { include: "pet", limit: 5 });
    assert.equal(response.ok, true);
    assert.equal(response.result.result.items[0].lookups.pet.name, "Fido");
    assert.equal(response.result.result.items[0].lookups.pet.species, "dog");
    assert.equal(response.result.result.items[1].lookups.pet.name, "Mabel");
  });

  await t.test("included relationship plus sparse primary and related fields", async () => {
    const response = await executeList(fixture, toolSet, {
      workspaceSlug: "model-controlled-workspace",
      include: "pet",
      fields: { bookings: ["petId"], pets: ["name"] },
      limit: 5
    });
    assert.equal(response.ok, true);
    assert.notEqual(response.error?.code, "assistant_tool_output_invalid");
    assert.deepEqual(JSON.parse(JSON.stringify(response.result.result.items)), [
      {
        id: "41",
        petId: 7,
        lookups: {
          petId: { id: "7", name: "Fido" },
          pet: { id: "7", name: "Fido" }
        }
      },
      {
        id: "42",
        petId: 8,
        lookups: {
          petId: { id: "8", name: "Mabel" },
          pet: { id: "8", name: "Mabel" }
        }
      }
    ]);
    assert.equal(Object.hasOwn(response.result.result.items[0], "summary"), false);
    assert.equal(Object.hasOwn(response.result.result.items[0].lookups.pet, "species"), false);
    assert.deepEqual(
      validateSchemaPayload(listDefinition.extensions.assistant.output, response.result.result, {
        phase: "output"
      }),
      response.result.result
    );
    assert.equal(fixture.calls.at(-1).query.workspaceSlug, undefined);
    assert.equal(fixture.calls.at(-1).context.workspace.slug, "north-clinic");
  });

  await t.test("limit and cursor truncation remain bounded", async () => {
    const response = await executeList(fixture, toolSet, { limit: 1 });
    assert.equal(response.ok, true);
    assert.equal(response.result.result.items.length, 1);
    assert.equal(response.result.result.nextCursor, "after-41");
    assert.equal(fixture.calls.at(-1).query.limit, 1);
  });

  await t.test("invalid array-shaped include gives an actionable validation result", async () => {
    const response = await executeList(fixture, toolSet, { include: ["pet"] });
    assert.equal(response.ok, false);
    assert.equal(response.error.code, "ACTION_VALIDATION_FAILED");
    assert.equal(response.error.status, 400);
    assert.match(response.error.message, /include expects a comma-separated string such as "pet,service"/u);
  });

  await t.test("invalid array-shaped fields gives an actionable validation result", async () => {
    const response = await executeList(fixture, toolSet, { fields: ["pet.name"] });
    assert.equal(response.ok, false);
    assert.equal(response.error.code, "ACTION_VALIDATION_FAILED");
    assert.equal(response.error.status, 400);
    assert.match(
      response.error.message,
      /fields expects an object keyed by JSON:API resource type, such as \{"bookings":\["petId"\],"pets":\["name"\]\}/u
    );
  });

  await t.test("relationship aliases are rejected as sparse-fieldset resource keys", async () => {
    const callCount = fixture.calls.length;
    const response = await executeList(fixture, toolSet, {
      include: "pet",
      fields: { pet: ["name"] },
      limit: 3
    });
    assert.equal(response.ok, false);
    assert.equal(response.error.code, "ACTION_VALIDATION_FAILED");
    assert.equal(response.error.status, 400);
    assert.match(response.error.message, /fields\.pet: fields keys must be JSON:API resource types/u);
    assert.match(response.error.message, /Allowed keys: "bookings", "pets"/u);
    assert.match(response.error.message, /use "pets" instead of "pet"/u);
    assert.equal(fixture.calls.length, callCount);
  });

  await t.test("permission denial removes the generated action from native discovery", async () => {
    const deniedContext = {
      ...fixture.context,
      permissions: []
    };
    const deniedToolSet = fixture.catalog.resolveToolSet(deniedContext);
    assert.deepEqual(deniedToolSet.tools, []);
    assert.deepEqual(await fixture.catalog.executeToolCall({
      toolName: "crud_bookings_list",
      argumentsText: "{}",
      context: deniedContext,
      toolSet: deniedToolSet
    }), {
      ok: false,
      error: {
        code: "assistant_tool_unknown",
        message: "Unknown tool."
      }
    });
  });
});
