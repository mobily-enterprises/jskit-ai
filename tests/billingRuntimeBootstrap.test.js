import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from "node:worker_threads";

const SERVER_ENTRY_URL = new URL("../server.js", import.meta.url).href;

function runBootstrap(envOverrides = {}) {
  return new Promise((resolve) => {
    const worker = new Worker(
      `
        import { parentPort } from "node:worker_threads";
        await import(${JSON.stringify(SERVER_ENTRY_URL)});
        parentPort.postMessage({ ok: true });
      `,
      {
        eval: true,
        type: "module",
        env: {
          ...process.env,
          NODE_ENV: "test",
          ...envOverrides
        }
      }
    );

    let settled = false;

    worker.once("message", () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        status: 0,
        stderr: ""
      });
    });

    worker.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        status: 1,
        stderr: String(error?.stack || error?.message || error || "")
      });
    });

    worker.once("exit", (code) => {
      if (settled || code === 0) {
        return;
      }
      settled = true;
      resolve({
        status: Number.isInteger(code) ? code : 1,
        stderr: ""
      });
    });
  });
}

test("server bootstrap succeeds with billing disabled and no billing secrets", async () => {
  const child = await runBootstrap({
    BILLING_ENABLED: "false",
    BILLING_OPERATION_KEY_SECRET: "",
    BILLING_PROVIDER_IDEMPOTENCY_KEY_SECRET: "",
    BILLING_STRIPE_WEBHOOK_ENDPOINT_SECRET: ""
  });

  const stderr = String(child.stderr || "").trim();
  assert.equal(
    child.status,
    0,
    `Expected bootstrap import to succeed when billing is disabled.${stderr ? ` stderr: ${stderr}` : ""}`
  );
});

test("server bootstrap succeeds with billing enabled for stripe when paddle secrets are unset", async () => {
  const child = await runBootstrap({
    BILLING_ENABLED: "true",
    BILLING_PROVIDER: "stripe",
    APP_PUBLIC_URL: "https://app.example.test",
    BILLING_OPERATION_KEY_SECRET: "op_secret",
    BILLING_PROVIDER_IDEMPOTENCY_KEY_SECRET: "idem_secret",
    BILLING_STRIPE_SECRET_KEY: "sk_test_123",
    BILLING_STRIPE_API_VERSION: "2024-06-20",
    BILLING_STRIPE_WEBHOOK_ENDPOINT_SECRET: "whsec_stripe_test",
    BILLING_PADDLE_API_KEY: "",
    BILLING_PADDLE_WEBHOOK_ENDPOINT_SECRET: ""
  });

  const stderr = String(child.stderr || "").trim();
  assert.equal(
    child.status,
    0,
    `Expected bootstrap import to succeed for stripe without paddle secrets.${stderr ? ` stderr: ${stderr}` : ""}`
  );
});

test("server bootstrap succeeds with billing enabled for paddle when stripe secrets are unset", async () => {
  const child = await runBootstrap({
    BILLING_ENABLED: "true",
    BILLING_PROVIDER: "paddle",
    APP_PUBLIC_URL: "https://app.example.test",
    BILLING_OPERATION_KEY_SECRET: "op_secret",
    BILLING_PROVIDER_IDEMPOTENCY_KEY_SECRET: "idem_secret",
    BILLING_PADDLE_API_KEY: "pdl_test_123",
    BILLING_PADDLE_WEBHOOK_ENDPOINT_SECRET: "whsec_paddle_test",
    BILLING_STRIPE_SECRET_KEY: "",
    BILLING_STRIPE_API_VERSION: "",
    BILLING_STRIPE_WEBHOOK_ENDPOINT_SECRET: ""
  });

  const stderr = String(child.stderr || "").trim();
  assert.equal(
    child.status,
    0,
    `Expected bootstrap import to succeed for paddle without stripe secrets.${stderr ? ` stderr: ${stderr}` : ""}`
  );
});

test("server bootstrap fails closed when billing enabled without operation key secret", async () => {
  const child = await runBootstrap({
    BILLING_ENABLED: "true",
    BILLING_PROVIDER: "stripe",
    APP_PUBLIC_URL: "https://app.example.test",
    BILLING_OPERATION_KEY_SECRET: "",
    BILLING_PROVIDER_IDEMPOTENCY_KEY_SECRET: "idem_secret",
    BILLING_STRIPE_SECRET_KEY: "sk_test_123",
    BILLING_STRIPE_API_VERSION: "2024-06-20",
    BILLING_STRIPE_WEBHOOK_ENDPOINT_SECRET: "whsec_stripe_test"
  });

  const stderr = String(child.stderr || "");
  assert.equal(child.status, 1, "Expected bootstrap import to fail with missing operation key secret.");
  assert.match(stderr, /operationKeySecret is required/i);
});

test("server bootstrap fails closed when billing enabled without provider idempotency secret", async () => {
  const child = await runBootstrap({
    BILLING_ENABLED: "true",
    BILLING_PROVIDER: "stripe",
    APP_PUBLIC_URL: "https://app.example.test",
    BILLING_OPERATION_KEY_SECRET: "op_secret",
    BILLING_PROVIDER_IDEMPOTENCY_KEY_SECRET: "",
    BILLING_STRIPE_SECRET_KEY: "sk_test_123",
    BILLING_STRIPE_API_VERSION: "2024-06-20",
    BILLING_STRIPE_WEBHOOK_ENDPOINT_SECRET: "whsec_stripe_test"
  });

  const stderr = String(child.stderr || "");
  assert.equal(child.status, 1, "Expected bootstrap import to fail with missing provider idempotency secret.");
  assert.match(stderr, /providerIdempotencyKeySecret is required/i);
});

test("server bootstrap fails closed when billing enabled without app public url", async () => {
  const child = await runBootstrap({
    BILLING_ENABLED: "true",
    BILLING_PROVIDER: "stripe",
    APP_PUBLIC_URL: "",
    BILLING_OPERATION_KEY_SECRET: "op_secret",
    BILLING_PROVIDER_IDEMPOTENCY_KEY_SECRET: "idem_secret",
    BILLING_STRIPE_SECRET_KEY: "sk_test_123",
    BILLING_STRIPE_API_VERSION: "2024-06-20",
    BILLING_STRIPE_WEBHOOK_ENDPOINT_SECRET: "whsec_stripe_test"
  });

  const stderr = String(child.stderr || "");
  assert.equal(child.status, 1, "Expected bootstrap import to fail with missing APP_PUBLIC_URL.");
  assert.match(stderr, /APP_PUBLIC_URL is required/i);
});
