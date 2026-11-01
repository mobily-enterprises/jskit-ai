import test from "node:test";
import assert from "node:assert/strict";
import { returnJsonApiData, returnJsonApiDocument } from "@jskit-ai/http-runtime/shared";
import { buildCrudRecordChangedEvent, resolveCrudJsonApiEntityIdFromResult } from "../src/server/serviceEvents.js";

test("resolveCrudJsonApiEntityIdFromResult reads the created record's id from a tagged JSON:API result of either kind", () => {
  assert.equal(resolveCrudJsonApiEntityIdFromResult({ result: returnJsonApiDocument({ data: { id: 15 } }) }), "15");
  assert.equal(resolveCrudJsonApiEntityIdFromResult({ result: returnJsonApiData({ id: 16, title: "Kindred" }) }), "16");
  assert.equal(resolveCrudJsonApiEntityIdFromResult({ result: { data: { id: 17 } } }), "",
    "an untagged document is not a create result");
  assert.equal(resolveCrudJsonApiEntityIdFromResult({ result: { kind: "document", value: { data: { id: 18 } } } }), "",
    "a look-alike without the result tag is not a create result");
  assert.equal(resolveCrudJsonApiEntityIdFromResult({ result: returnJsonApiDocument({ data: null }) }), "");
  assert.equal(resolveCrudJsonApiEntityIdFromResult({ result: returnJsonApiData(null) }), "");
  assert.equal(resolveCrudJsonApiEntityIdFromResult({ result: returnJsonApiDocument({ data: { id: "   " } }) }), "");
});

test("buildCrudRecordChangedEvent announces a CRUD record change as the namespace's record-changed event", () => {
  const buildEvent = buildCrudRecordChangedEvent({
    namespace: "pet-notes",
    operation: "created",
    entityId: resolveCrudJsonApiEntityIdFromResult,
    audience: "event_scope"
  });
  const event = buildEvent({
    context: { actor: { id: 4 } },
    result: returnJsonApiDocument({ data: { type: "pet-notes", id: "12", attributes: {} } })
  });

  assert.equal(event.type, "entity.changed");
  assert.equal(event.source, "crud");
  assert.equal(event.entity, "record");
  assert.equal(event.operation, "created");
  assert.equal(event.entityId, "12");
  assert.equal(event.actorId, "4");
  assert.equal(event.realtime.event, "pet_notes.record.changed");
  assert.equal(event.realtime.audience, "event_scope");
});
