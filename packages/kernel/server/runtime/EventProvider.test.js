import assert from "node:assert/strict";
import test from "node:test";
import { createEventRuntime } from "./EventProvider.js";

test("event runtime publishes ephemeral events to explicit listeners in registration order", async () => {
  const events = createEventRuntime();
  const calls = [];
  events.register({
    id: "first",
    handle(event) {
      calls.push(`first:${event.type}`);
    }
  });
  events.register({
    id: "matching",
    matches(event) {
      return event.type === "book.saved";
    },
    handle(event) {
      calls.push(`matching:${event.bookId}`);
    }
  });

  await events.publish({ type: "book.saved", bookId: "12" });

  assert.deepEqual(calls, ["first:book.saved", "matching:12"]);
  assert.deepEqual(events.diagnostics().listenerIds, ["first", "matching"]);
  assert.throws(
    () => events.register({ id: "first", handle() {} }),
    /duplicated/u
  );
});
