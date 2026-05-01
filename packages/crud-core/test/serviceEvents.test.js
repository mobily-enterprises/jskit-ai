import test from "node:test";
import assert from "node:assert/strict";
import {
  createCrudJsonApiServiceEvents,
  createCrudServiceEvents,
  resolveCrudEntityIdFromArgs,
  resolveCrudEntityIdFromResult,
  resolveCrudJsonApiEntityIdFromResult
} from "../src/server/serviceEvents.js";

test("createCrudServiceEvents builds CRUD realtime events from resource namespace", () => {
  const events = createCrudServiceEvents({
    namespace: "contacts"
  });

  assert.equal(events.createRecord[0].realtime.event, "contacts.record.changed");
  assert.equal(events.updateRecord[0].realtime.event, "contacts.record.changed");
  assert.equal(events.deleteRecord[0].realtime.event, "contacts.record.changed");
});

test("createCrudServiceEvents normalizes namespace into realtime event format", () => {
  const events = createCrudServiceEvents({
    namespace: "customer-orders"
  });

  assert.equal(events.createRecord[0].realtime.event, "customer_orders.record.changed");
});

test("createCrudServiceEvents validates required resource namespace", () => {
  assert.throws(
    () => createCrudServiceEvents({}),
    /resource\.namespace/
  );
});

test("createCrudJsonApiServiceEvents builds JSON:API-aware create/update/delete event defaults", () => {
  const events = createCrudJsonApiServiceEvents("contacts");

  assert.equal(events.createDocument[0].realtime.event, "contacts.record.changed");
  assert.equal(events.patchDocumentById[0].realtime.event, "contacts.record.changed");
  assert.equal(events.deleteDocumentById[0].realtime.event, "contacts.record.changed");
  assert.equal(events.createDocument[0].entityId({
    result: {
      data: {
        id: "21"
      }
    }
  }), "21");
  assert.equal(events.patchDocumentById[0].entityId({
    args: [22]
  }), "22");
  assert.equal(events.deleteDocumentById[0].entityId({
    args: [23]
  }), "23");
});

test("service event entity-id helpers normalize ids from args, plain results, and JSON:API results", () => {
  assert.equal(resolveCrudEntityIdFromArgs({ args: [12] }), "12");
  assert.equal(resolveCrudEntityIdFromResult({ result: { id: 13 } }), "13");
  assert.equal(resolveCrudJsonApiEntityIdFromResult({
    result: {
      data: {
        id: 14
      }
    }
  }), "14");
  assert.equal(resolveCrudEntityIdFromArgs({ args: ["   "] }), "");
});
