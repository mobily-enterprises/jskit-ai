import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("workflow and guide docs require Playwright plus dev auth bypass for authenticated UI", async () => {
  const featureDelivery = await readFile(path.join(packageRoot, "workflow/feature-delivery.md"), "utf8");
  const review = await readFile(path.join(packageRoot, "workflow/review.md"), "utf8");
  const pattern = await readFile(path.join(packageRoot, "patterns/ui-testing.md"), "utf8");
  const authGuide = await readFile(path.join(packageRoot, "site/guide/app-setup/authentication.md"), "utf8");

  assert.match(featureDelivery, /adds or changes user-facing UI must include a Playwright flow/);
  assert.match(featureDelivery, /jskit app verify-ui/);
  assert.match(featureDelivery, /--against <base-ref>/);
  assert.match(featureDelivery, /\/api\/dev-auth\/login-as/);
  assert.match(featureDelivery, /must not be enabled in production/);

  assert.match(review, /any added or changed user-facing UI must be exercised with Playwright/);
  assert.match(review, /--against <base-ref>/);
  assert.match(review, /development-only .*\/api\/dev-auth\/login-as/);

  assert.match(pattern, /^# UI Testing Pattern$/m);
  assert.match(pattern, /jskit app verify-ui/);
  assert.match(pattern, /--against origin\/main/);
  assert.match(pattern, /jskit doctor --against origin\/main/);
  assert.match(pattern, /\/api\/dev-auth\/login-as/);
  assert.match(pattern, /AUTH_DEV_BYPASS_ENABLED=true/);
  assert.match(pattern, /csrf-token/);

  assert.match(authGuide, /^### Authenticated Playwright testing with the dev auth bypass$/m);
  assert.match(authGuide, /jskit app verify-ui/);
  assert.match(authGuide, /--against origin\/main/);
  assert.match(authGuide, /jskit doctor --against origin\/main/);
  assert.match(authGuide, /AUTH_DEV_BYPASS_ENABLED=true/);
  assert.match(authGuide, /POST \/api\/dev-auth\/login-as/);
  assert.match(authGuide, /This is the standard path the agent should use for authenticated browser tests/);
});
