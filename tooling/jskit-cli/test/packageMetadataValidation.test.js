import assert from "node:assert/strict";
import test from "node:test";
import { validatePackageMetadataShape } from "../src/server/cliRuntime/packageMetadataValidation.js";

function packageMetadata(kind, fileMutation) {
  return {
    packageId: "@jskit-ai/migration-contract-test",
    version: "0.1.0",
    kind,
    runtime: {
      server: { providers: [] },
      client: { providers: [] }
    },
    mutations: {
      files: [fileMutation]
    }
  };
}

test("runtime migration metadata is deterministic without install options", () => {
  const fixedMigration = {
    op: "install-migration",
    from: "templates/fixed.cjs",
    id: "fixed-schema"
  };
  assert.equal(
    validatePackageMetadataShape(
      packageMetadata("runtime", fixedMigration),
      "fixed/package.json#jskit"
    ).mutations.files[0],
    fixedMigration
  );

  for (const parameterizedMigration of [
    {
      ...fixedMigration,
      id: "schema-${option:namespace|kebab}"
    },
    {
      ...fixedMigration,
      when: { option: "database", equals: "mysql" }
    }
  ]) {
    assert.throws(
      () => validatePackageMetadataShape(
        packageMetadata("runtime", parameterizedMigration),
        "parameterized/package.json#jskit"
      ),
      /runtime install-migration.*deterministic.*cannot reference package options/u
    );
  }
});

test("generator migration metadata can use generation options", () => {
  const migration = {
    op: "install-migration",
    from: "templates/schema.cjs",
    id: "schema-${option:namespace|kebab}"
  };
  assert.equal(
    validatePackageMetadataShape(
      packageMetadata("generator", migration),
      "generator/package.json#jskit"
    ).mutations.files[0],
    migration
  );
});
