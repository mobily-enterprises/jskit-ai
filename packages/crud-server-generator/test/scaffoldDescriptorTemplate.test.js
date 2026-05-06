import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(TEST_DIRECTORY, "..");

test("crud server scaffold descriptor template records table ownership provenance", async () => {
  const source = await readFile(
    path.join(PACKAGE_ROOT, "templates/src/local-package/package.descriptor.mjs"),
    "utf8"
  );

  assert.match(source, /scaffoldShape: "crud-server-v1"/);
  assert.match(source, /tableName: __JSKIT_CRUD_TABLE_NAME__/);
  assert.match(source, /provenance: "crud-server-generator"/);
  assert.match(source, /ownerKind: "crud-package"/);
});
