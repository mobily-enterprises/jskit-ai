import assert from "node:assert/strict";
import test from "node:test";
import { validatePackageMetadataShape } from "../src/server/cliRuntime/packageMetadataValidation.js";

function createPackageMetadata(ci) {
  return {
    packageId: "@jskit-ai/ci-contract-test",
    version: "0.1.0",
    kind: "runtime",
    runtime: {
      server: { providers: [] },
      client: { providers: [] }
    },
    ci
  };
}

test("package metadata validation normalizes a package CI contract", () => {
  const packageMetadata = validatePackageMetadataShape(createPackageMetadata({
    environment: {
      PORT: 3306,
      ENABLED: true
    },
    services: [
      {
        id: "database",
        image: "database:test",
        environment: { PASSWORD: "synthetic" },
        ports: ["3306:3306"],
        healthCheck: {
          command: "healthcheck",
          interval: "10s",
          timeout: "5s",
          retries: 4
        }
      }
    ],
    steps: [
      {
        id: "prepare-database",
        phase: "before-verify",
        label: "Prepare database",
        command: "npm run prepare:database"
      }
    ]
  }), "fixture/package.json#jskit");

  assert.deepEqual(packageMetadata.ci.environment, {
    ENABLED: "true",
    PORT: "3306"
  });
  assert.equal(packageMetadata.ci.services[0].id, "database");
  assert.equal(packageMetadata.ci.steps[0].phase, "before-verify");
});

test("package metadata validation rejects malformed CI environment, services, and steps", () => {
  assert.throws(
    () => validatePackageMetadataShape(createPackageMetadata({ environment: [] }), "environment.package.json#jskit"),
    /ci\.environment must be an object/u
  );
  assert.throws(
    () => validatePackageMetadataShape(createPackageMetadata({ services: [{ image: "database:test" }] }), "service.package.json#jskit"),
    /ci\.services\[0\]\.id must match/u
  );
  assert.throws(
    () => validatePackageMetadataShape(createPackageMetadata({
      steps: [{ id: "prepare", phase: "after-verify", label: "Prepare", command: "npm run prepare" }]
    }), "step.package.json#jskit"),
    /phase must be one of: before-verify/u
  );
  assert.throws(
    () => validatePackageMetadataShape(createPackageMetadata({
      steps: [{ id: "verify", phase: "before-verify", label: "Replace verify", command: "false" }]
    }), "reserved.package.json#jskit"),
    /id "verify" is reserved/u
  );
  assert.throws(
    () => validatePackageMetadataShape(createPackageMetadata({ env: { DB_CLIENT: "mysql2" } }), "typo.package.json#jskit"),
    /ci contains unsupported field: env/u
  );
});
