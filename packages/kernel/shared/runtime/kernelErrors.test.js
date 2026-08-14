import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Application, createProviderClass } from "./application.js";
import { KernelError, ProviderStartOrderError } from "./kernelErrors.js";

const APPLICATION_PATH = fileURLToPath(new URL("./application.js", import.meta.url));

test("KernelError preserves structured details while exposing the standard cause", () => {
  const cause = new Error("underlying failure");
  const error = new KernelError("outer failure", {
    cause,
    providerId: "example.provider"
  });

  assert.equal(error.cause, cause);
  assert.equal(error.details.cause, cause);
  assert.equal(error.details.providerId, "example.provider");
});

test("startsAfter orders provider registration, boot, and shutdown", async () => {
  const calls = [];
  const EarlierProvider = createProviderClass({
    id: "example.earlier",
    register() {
      calls.push("register:earlier");
    },
    boot() {
      calls.push("boot:earlier");
    },
    shutdown() {
      calls.push("shutdown:earlier");
    }
  });
  const LaterProvider = createProviderClass({
    id: "example.later",
    startsAfter: ["example.earlier"],
    register() {
      calls.push("register:later");
    },
    boot() {
      calls.push("boot:later");
    },
    shutdown() {
      calls.push("shutdown:later");
    }
  });

  const app = new Application();
  await app.start({ providers: [LaterProvider, EarlierProvider] });
  await app.shutdown();

  assert.deepEqual(calls, [
    "register:earlier",
    "register:later",
    "boot:earlier",
    "boot:later",
    "shutdown:later",
    "shutdown:earlier"
  ]);
});

test("startsAfter rejects missing providers and start-order cycles", () => {
  const missingApp = new Application();
  assert.throws(
    () => missingApp.configureProviders([{ id: "example.later", startsAfter: ["example.missing"] }]),
    (error) =>
      error instanceof ProviderStartOrderError &&
      /starts after missing provider "example\.missing"/u.test(error.message)
  );

  const cycleApp = new Application();
  assert.throws(
    () => cycleApp.configureProviders([
      { id: "example.alpha", startsAfter: ["example.beta"] },
      { id: "example.beta", startsAfter: ["example.alpha"] }
    ]),
    (error) =>
      error instanceof ProviderStartOrderError &&
      /Provider start-order cycle detected/u.test(error.message)
  );
});

test("provider lifecycle failures expose their cause in Node test output", async (context) => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "jskit-kernel-error-"));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const fixturePath = path.join(fixtureRoot, "provider-lifecycle-failure.test.mjs");
  const source = `
import { Application } from ${JSON.stringify(APPLICATION_PATH)};
import test from "node:test";

test("generated server starts", async () => {
  const app = new Application();
  app.configureProviders([{
    id: "json-rest-api.core",
    async boot() {
      throw new Error("DB_CLIENT is required. Use mysql2 or pg.");
    }
  }]);
  await app.bootProviders();
});
`;
  await writeFile(fixturePath, source, "utf8");
  const childEnvironment = { ...process.env };
  delete childEnvironment.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--test", fixturePath], {
    encoding: "utf8",
    env: childEnvironment
  });
  const output = `${String(result.stdout || "")}\n${String(result.stderr || "")}`;

  assert.equal(result.status, 1, output);
  assert.match(output, /Provider "json-rest-api\.core" failed during boot\(\)\./u);
  assert.match(output, /DB_CLIENT is required\. Use mysql2 or pg\./u);
});
