import assert from "node:assert/strict";
import test from "node:test";
import { MESSAGE_KEY_SOURCE } from "../../connectors-core/src/shared/configuration.js";
import * as keyed from "../src/shared/definitions.js";
import * as english from "../src/shared/english-definitions.js";
import * as englishAi from "../src/shared/english-ai.js";
import { aiAccessLabels as keyedAccessLabels } from "../src/shared/ai.js";

function strings(value, found = [], seen = new Set()) {
  if (typeof value === "string") {
    found.push(value);
  } else if (typeof value === "function") {
    try { strings(value({}), found, seen); } catch { /* settings-specific function */ }
  } else if (value && typeof value === "object" && !seen.has(value) && [Object.prototype, Array.prototype].includes(Object.getPrototypeOf(value))) {
    seen.add(value);
    Object.values(value).forEach((inner) => strings(inner, found, seen));
  }
  return found;
}

test("the public catalog exports every definition, in English", () => {
  assert.deepEqual(Object.keys(english).sort(), Object.keys(keyed).sort());
  const keys = strings(english.connectorDefinitions).filter((text) => text.startsWith("jskit."));
  assert.deepEqual(keys, []);
  assert.equal(englishAi.aiAccessLabels.paid, "Paid · connection required");
  assert.equal(englishAi.aiDefinition, english.aiDefinition);
});

test("an English definition keeps its keyed original, and a copy does not", () => {
  const mapbox = english.connectorDefinitions.find((definition) => definition.id === "mapbox");
  assert.equal(mapbox.description, "Validate a backend access token and look up places or coordinates.");
  assert.equal(mapbox[MESSAGE_KEY_SOURCE], keyed.mapboxDefinition);
  assert.equal(mapbox[MESSAGE_KEY_SOURCE].description, "jskit.connectors.mapbox.description");
  assert.equal({ ...mapbox }[MESSAGE_KEY_SOURCE], undefined);
  assert.equal(englishAi.aiAccessLabels[MESSAGE_KEY_SOURCE], keyedAccessLabels);
  assert.ok(Object.isFrozen(mapbox));
});
