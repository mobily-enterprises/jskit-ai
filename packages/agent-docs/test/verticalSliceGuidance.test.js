import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("workflow and blueprint require vertical-slice chunk planning", async () => {
  const featureDelivery = await readFile(path.join(packageRoot, "workflow/feature-delivery.md"), "utf8");
  const blueprintTemplate = await readFile(path.join(packageRoot, "templates/APP_BLUEPRINT.md"), "utf8");

  assert.match(featureDelivery, /Prefer vertical slices/);
  assert.match(featureDelivery, /user-visible or end-to-end outcome/);
  assert.match(featureDelivery, /Avoid horizontal plans like "database first, then routes, then UI"/);

  assert.match(blueprintTemplate, /Prefer vertical slices that produce visible or end-to-end progress/);
});
