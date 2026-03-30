import assert from "node:assert/strict";
import test from "node:test";
import { createCommandHandlers } from "../src/server/core/createCommandHandlers.js";

function createStdoutCapture() {
  const chunks = [];
  return {
    stdout: {
      write(value) {
        chunks.push(String(value || ""));
      }
    },
    read() {
      return chunks.join("");
    }
  };
}

function createLintHandlers({ packageRegistry, bundleRegistry, insightsByPackageId }) {
  return createCommandHandlers({
    loadPackageRegistry: async () => packageRegistry,
    loadBundleRegistry: async () => bundleRegistry,
    inspectPackageOfferings: async ({ packageEntry }) => {
      return insightsByPackageId.get(String(packageEntry?.packageId || "").trim()) || {
        available: true,
        notes: [],
        containerBindings: {
          server: [],
          client: []
        }
      };
    }
  });
}

function createPackageEntry({ packageId, serverTokens = [], clientTokens = [] }) {
  return {
    packageId,
    descriptor: {
      metadata: {
        apiSummary: {
          containerTokens: {
            server: serverTokens,
            client: clientTokens
          }
        }
      }
    }
  };
}

test("commandLintDescriptors passes when descriptor tokens match provider bindings", async () => {
  const packageId = "@jskit-ai/demo-pass";
  const packageRegistry = new Map([
    [
      packageId,
      createPackageEntry({
        packageId,
        serverTokens: ["demo.server.service"],
        clientTokens: ["demo.client.service"]
      })
    ]
  ]);
  const bundleRegistry = new Map([["demo-bundle", { bundleId: "demo-bundle" }]]);
  const insightsByPackageId = new Map([
    [
      packageId,
      {
        available: true,
        notes: [],
        containerBindings: {
          server: [
            {
              token: "demo.server.service",
              tokenExpression: "\"demo.server.service\"",
              tokenResolved: true,
              location: "src/server/provider.js:8"
            }
          ],
          client: [
            {
              token: "demo.client.service",
              tokenExpression: "\"demo.client.service\"",
              tokenResolved: true,
              location: "src/client/provider.js:5"
            }
          ]
        }
      }
    ]
  ]);

  const handlers = createLintHandlers({ packageRegistry, bundleRegistry, insightsByPackageId });
  const capture = createStdoutCapture();
  const status = await handlers.commandLintDescriptors({
    options: {
      json: false,
      checkDiLabels: true
    },
    stdout: capture.stdout
  });

  assert.equal(status, 0);
  const output = capture.read();
  assert.match(output, /Descriptor lint passed\./);
  assert.match(output, /DI label parity check passed\./);
});

test("commandLintDescriptors fails on unresolved token expressions in strict mode", async () => {
  const packageId = "@jskit-ai/demo-unresolved";
  const packageRegistry = new Map([
    [
      packageId,
      createPackageEntry({
        packageId,
        serverTokens: ["demo.server.service"],
        clientTokens: []
      })
    ]
  ]);
  const bundleRegistry = new Map();
  const insightsByPackageId = new Map([
    [
      packageId,
      {
        available: true,
        notes: [],
        containerBindings: {
          server: [
            {
              token: "demo.server.service",
              tokenExpression: "resolveTokenName()",
              tokenResolved: false,
              location: "src/server/provider.js:22"
            }
          ],
          client: []
        }
      }
    ]
  ]);

  const handlers = createLintHandlers({ packageRegistry, bundleRegistry, insightsByPackageId });
  const capture = createStdoutCapture();
  const status = await handlers.commandLintDescriptors({
    options: {
      json: false,
      checkDiLabels: true
    },
    stdout: capture.stdout
  });

  assert.equal(status, 1);
  const output = capture.read();
  assert.match(output, /DI label parity check failed/);
  assert.match(output, /\[binding-token-unresolved\]/);
});

test("commandLintDescriptors --json includes strict DI issue payload", async () => {
  const packageId = "@jskit-ai/demo-json";
  const packageRegistry = new Map([
    [
      packageId,
      createPackageEntry({
        packageId,
        serverTokens: ["demo.server.declared"],
        clientTokens: []
      })
    ]
  ]);
  const bundleRegistry = new Map();
  const insightsByPackageId = new Map([
    [
      packageId,
      {
        available: true,
        notes: [],
        containerBindings: {
          server: [
            {
              token: "demo.server.actual",
              tokenExpression: "\"demo.server.actual\"",
              tokenResolved: true,
              location: "src/server/provider.js:10"
            }
          ],
          client: []
        }
      }
    ]
  ]);

  const handlers = createLintHandlers({ packageRegistry, bundleRegistry, insightsByPackageId });
  const capture = createStdoutCapture();
  const status = await handlers.commandLintDescriptors({
    options: {
      json: true,
      checkDiLabels: true
    },
    stdout: capture.stdout
  });

  assert.equal(status, 1);
  const payload = JSON.parse(capture.read());
  assert.equal(payload.diLabelCheck?.enabled, true);
  assert.ok(payload.diLabelCheck?.issueCount > 0);
  const issues = Array.isArray(payload.diLabelCheck?.issues) ? payload.diLabelCheck.issues : [];
  assert.ok(issues.some((issue) => issue.code === "binding-token-undeclared"));
  assert.ok(issues.some((issue) => issue.code === "descriptor-token-unused"));
});
