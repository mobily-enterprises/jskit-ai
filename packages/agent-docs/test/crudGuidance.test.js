import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("workflow and patterns require CRUD server scaffolding before CRUD UI or hand migrations", async () => {
  const scoping = await readFile(path.join(packageRoot, "workflow/scoping.md"), "utf8");
  const featureDelivery = await readFile(path.join(packageRoot, "workflow/feature-delivery.md"), "utf8");
  const review = await readFile(path.join(packageRoot, "workflow/review.md"), "utf8");
  const patternIndex = await readFile(path.join(packageRoot, "patterns/INDEX.md"), "utf8");
  const pattern = await readFile(path.join(packageRoot, "patterns/crud-scaffolding.md"), "utf8");

  assert.match(scoping, /exact `jskit generate crud-server-generator scaffold \.\.\.` command/);
  assert.match(scoping, /Before accepting a new persisted app-owned table, decide whether it is CRUD-owned or a narrow explicit exception/);
  assert.match(scoping, /Do not plan a separate hand-written CRUD migration/);

  assert.match(featureDelivery, /Create the real table directly in the database before scaffolding/);
  assert.match(featureDelivery, /every persisted app-owned table must have a server CRUD package/);
  assert.match(featureDelivery, /do not hand-write a separate migration for that CRUD table/);
  assert.match(featureDelivery, /Scaffold the server side first with `crud-server-generator`, even if no CRUD UI will be created yet/);
  assert.match(featureDelivery, /Do not hand-build CRUD routes, CRUD endpoints, or CRUD page trees before `crud-server-generator` has created the server package and shared resource file/);
  assert.match(featureDelivery, /`feature-server-generator` is for non-CRUD workflows and orchestration/);
  assert.match(featureDelivery, /Keep direct knex exceptional and minimal/);

  assert.match(review, /was `crud-server-generator scaffold` used before any CRUD UI or CRUD route hand-coding/);
  assert.match(review, /does every live app-owned table now have either declared generated\/package CRUD ownership or an explicit narrow `.jskit\/table-ownership\.json` exception/);
  assert.match(review, /is any direct app-owned knex usage limited to generated CRUD packages or explicit weird-custom feature lanes/);
  assert.match(review, /avoid a separate hand-written CRUD migration/);

  assert.match(patternIndex, /crud scaffold, crud server, crud ui, table creation, migrations/);
  assert.match(pattern, /^# CRUD Scaffolding Patterns$/m);
  assert.match(pattern, /start with `jskit generate crud-server-generator scaffold \.\.\.`/);
  assert.match(pattern, /every persisted app-owned table must go through that server CRUD step first/);
  assert.match(pattern, /do not hand-write a separate CRUD migration/);
  assert.match(pattern, /Do not scaffold CRUD UI, hand-build CRUD routes, or hand-build CRUD endpoints before the server CRUD package and shared resource file exist/);
  assert.match(pattern, /`feature-server-generator` is not the default lane for ordinary persisted entities/);
  assert.match(pattern, /Before taking that path, stop and ask the developer for explicit approval/);
  assert.match(pattern, /Record the exact approval and the approved exception in `.jskit\/WORKBOARD.md` before coding/);
  assert.match(pattern, /Without that explicit approval record, do not take the weird-custom persistence path/);
});
