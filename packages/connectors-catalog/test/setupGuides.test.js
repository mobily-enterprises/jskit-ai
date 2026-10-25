import assert from "node:assert/strict";
import test from "node:test";
import { connectorDefinitions } from "../src/shared/definitions.js";
import { workdayDefinition } from "../src/shared/workday.js";

test("every provider setup guide is the provider's own HTTPS documentation, never another builder's", () => {
  for (const definition of connectorDefinitions) {
    const url = definition?.setup?.url;
    if (!url) continue;
    const { protocol, hostname } = new URL(url);
    assert.equal(protocol, "https:", definition.id);
    assert.doesNotMatch(hostname, /(?:^|\.)lovable\.dev$/u, `${definition.id} links a competitor's setup page`);
  }
});

test("Workday's setup guide is Workday documentation for registering the API client", () => {
  assert.match(new URL(workdayDefinition.setup.url).hostname, /(?:^|\.)workday\.com$/u);
});
