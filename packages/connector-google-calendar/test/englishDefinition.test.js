import assert from "node:assert/strict";
import test from "node:test";
import { MESSAGE_KEY_SOURCE } from "../../connectors-core/src/shared/configuration.js";
import { googleCalendarDefinition as keyed } from "../src/shared/definition.js";
import { googleCalendarDefinition } from "../src/shared/english-definition.js";

test("the public definition is English and keeps its keyed original", () => {
  assert.equal(googleCalendarDefinition.description, "Read calendars and create, edit or cancel events.");
  assert.equal(googleCalendarDefinition.scopes[0].label, "List calendars");
  assert.ok(!JSON.stringify(googleCalendarDefinition).includes("jskit."));
  assert.equal(googleCalendarDefinition[MESSAGE_KEY_SOURCE], keyed);
  assert.equal(keyed.description, "jskit.connectors.googleCalendar.description");
});
