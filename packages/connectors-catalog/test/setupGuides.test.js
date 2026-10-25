import assert from "node:assert/strict";
import test from "node:test";
import * as definitions from "../src/shared/definitions.js";
import { workdayDefinition } from "../src/shared/workday.js";

test("every provider setup guide is the provider's own HTTPS documentation, never another builder's", () => {
  for (const [name, definition] of Object.entries(definitions)) {
    const url = definition?.setup?.url;
    if (!url) continue;
    const { protocol, hostname } = new URL(url);
    assert.equal(protocol, "https:", name);
    assert.doesNotMatch(hostname, /(?:^|\.)lovable\.dev$/u, `${name} links a competitor's setup page`);
  }
});

test("Workday's setup guide is Workday documentation for registering the API client", () => {
  assert.match(new URL(workdayDefinition.setup.url).hostname, /(?:^|\.)workday\.com$/u);
});
