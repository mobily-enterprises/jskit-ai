import assert from "node:assert/strict";
import test from "node:test";
import { validatePackageDescriptorShape } from "../src/server/cliRuntime/descriptorValidation.js";

function createDescriptor(ci) {
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

test("descriptor validation normalizes a package CI contract", () => {
  const descriptor = validatePackageDescriptorShape(createDescriptor({
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
  }), "fixture/package.descriptor.mjs");

  assert.deepEqual(descriptor.ci.environment, {
    ENABLED: "true",
    PORT: "3306"
  });
  assert.equal(descriptor.ci.services[0].id, "database");
  assert.equal(descriptor.ci.steps[0].phase, "before-verify");
});

test("descriptor validation rejects malformed CI environment, services, and steps", () => {
  assert.throws(
    () => validatePackageDescriptorShape(createDescriptor({ environment: [] }), "environment.descriptor.mjs"),
    /ci\.environment must be an object/u
  );
  assert.throws(
    () => validatePackageDescriptorShape(createDescriptor({ services: [{ image: "database:test" }] }), "service.descriptor.mjs"),
    /ci\.services\[0\]\.id must match/u
  );
  assert.throws(
    () => validatePackageDescriptorShape(createDescriptor({
      steps: [{ id: "prepare", phase: "after-verify", label: "Prepare", command: "npm run prepare" }]
    }), "step.descriptor.mjs"),
    /phase must be one of: before-verify/u
  );
  assert.throws(
    () => validatePackageDescriptorShape(createDescriptor({
      steps: [{ id: "verify", phase: "before-verify", label: "Replace verify", command: "false" }]
    }), "reserved.descriptor.mjs"),
    /id "verify" is reserved/u
  );
  assert.throws(
    () => validatePackageDescriptorShape(createDescriptor({ env: { DB_CLIENT: "mysql2" } }), "typo.descriptor.mjs"),
    /ci contains unsupported field: env/u
  );
});
