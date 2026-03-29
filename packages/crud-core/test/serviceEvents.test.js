import test from "node:test";
import assert from "node:assert/strict";
import { createCrudServiceEvents } from "../src/server/serviceEvents.js";

test("createCrudServiceEvents builds CRUD realtime events from resource namespace", () => {
  const events = createCrudServiceEvents({
    resource: "contacts"
  });

  assert.equal(events.createRecord[0].realtime.event, "contacts.record.changed");
  assert.equal(events.updateRecord[0].realtime.event, "contacts.record.changed");
  assert.equal(events.deleteRecord[0].realtime.event, "contacts.record.changed");
});

test("createCrudServiceEvents normalizes namespace into realtime event format", () => {
  const events = createCrudServiceEvents({
    resource: "customer-orders"
  });

  assert.equal(events.createRecord[0].realtime.event, "customer_orders.record.changed");
});

test("createCrudServiceEvents validates required resource namespace", () => {
  assert.throws(
    () => createCrudServiceEvents({}),
    /resource\.resource/
  );
});
