import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";
import createKnex from "knex";
import migration from "../migrations/connectors_core_initial.cjs";
import { createCredentialProtection, createKnexConnectionStore } from "../src/server/storage.js";

test("credential protection binds ciphertext to its record and supports key rotation", async () => {
  const oldKey = randomBytes(32);
  const nextKey = randomBytes(32);
  const old = createCredentialProtection({ keys: { old: oldKey }, activeKeyId: "old" });
  const current = createCredentialProtection({ keys: { old: oldKey, current: nextKey }, activeKeyId: "current" });
  const value = { accessToken: "a-secret-access-token", refreshToken: "a-secret-refresh-token" };
  const ciphertext = await old.seal(value, "account-1");
  assert.equal(ciphertext.includes(value.accessToken), false);
  assert.deepEqual(await current.open(ciphertext, "account-1"), value);
  await assert.rejects(current.open(ciphertext, "account-2"), { code: "connector_credentials_unavailable" });
  const parts = ciphertext.split(".");
  parts[3] = `${parts[3][0] === "A" ? "B" : "A"}${parts[3].slice(1)}`;
  await assert.rejects(current.open(parts.join("."), "account-1"), { code: "connector_credentials_unavailable" });
  const rotated = await current.seal(value, "account-1");
  await assert.rejects(old.open(rotated, "account-1"), { code: "connector_credentials_unavailable" });
  assert.throws(() => createCredentialProtection({ keys: { short: randomBytes(16) }, activeKeyId: "short" }));
});

const databaseUrl = process.env.CONNECTORS_TEST_DATABASE_URL;
test("durable connector storage on an isolated SQL database", { skip: !databaseUrl && "Set CONNECTORS_TEST_DATABASE_URL to a disposable connector test database." }, async (t) => {
  const url = new URL(databaseUrl);
  assert.match(url.pathname, /^\/jskit_connector_test_[a-z0-9_]+$/u, "Refuse to migrate a non-test database.");
  const knex = createKnex({ client: url.protocol === "postgres:" ? "pg" : "mysql2", connection: databaseUrl, pool: { min: 0, max: 4 } });
  const protection = createCredentialProtection({ keys: { test: randomBytes(32) }, activeKeyId: "test" });
  const store = createKnexConnectionStore({ knex, protection });
  const owner = { applicationId: "test-application", subjectId: "test-user" };
  const scope = { owner, integrationId: "calendar" };
  const connection = { tokens: { accessToken: "private-access", refreshToken: "private-refresh" }, version: 0 };
  await migration.up(knex);
  try {
    await t.test("persists encrypted records and reopens them through another database pool", async () => {
      await store.withConnection(scope, async ({ save }) => save(connection));
      const rows = await knex("connector_connections").select();
      assert.equal(JSON.stringify(rows).includes("private-access"), false);
      const otherKnex = createKnex({ client: knex.client.config.client, connection: databaseUrl, pool: { min: 0, max: 2 } });
      try {
        const reopened = createKnexConnectionStore({ knex: otherKnex, protection });
        assert.deepEqual(await reopened.withConnection(scope, async ({ connection }) => connection), connection);
        await Promise.all([store, reopened].map((instance) => instance.withConnection(scope, async ({ connection, save }) => {
          await save({ ...connection, version: connection.version + 1 });
        })));
        assert.equal(await reopened.withConnection(scope, async ({ connection }) => connection.version), 2);
      } finally { await otherKnex.destroy(); }
    });

    await t.test("rollback preserves the previous record and owners cannot read each other's credentials", async () => {
      await assert.rejects(store.withConnection(scope, async ({ save }) => {
        await save({ version: 999 });
        throw new Error("rollback");
      }), /rollback/u);
      assert.equal(await store.withConnection(scope, async ({ connection }) => connection.version), 2);
      const otherScope = { ...scope, owner: { ...owner, subjectId: "different-user" } };
      assert.equal(await store.withConnection(otherScope, async ({ connection }) => connection), null);
      const rows = await knex("connector_connections").select();
      const saved = rows.find((row) => row.payload);
      const empty = rows.find((row) => !row.payload);
      await knex("connector_connections").where({ connection_key: empty.connection_key }).update({ payload: saved.payload });
      await assert.rejects(store.withConnection(otherScope, async ({ connection }) => connection), { code: "connector_credentials_unavailable" });
      await knex("connector_connections").where({ connection_key: empty.connection_key }).update({ payload: null });
    });

    await t.test("consent is encrypted, scoped, consumed once and invalidated by disconnect", async () => {
      const attempt = { state: "random-authorization-state", codeVerifier: "private-pkce-verifier", owner, integrationId: "calendar", expiresAt: Date.now() + 60_000 };
      await store.withConnection(scope, async ({ putAttempt }) => putAttempt(attempt));
      const rows = await knex("connector_authorization_attempts").select();
      assert.equal(JSON.stringify(rows).includes(attempt.state), false);
      assert.equal(JSON.stringify(rows).includes(attempt.codeVerifier), false);
      const otherScope = { ...scope, owner: { ...owner, applicationId: "different-app" } };
      assert.equal(await store.withConnection(otherScope, async ({ latestAttempt }) => latestAttempt({ after: Date.now() })), null);
      assert.deepEqual(await store.withConnection(scope, async ({ latestAttempt }) => latestAttempt({ after: Date.now() })), attempt);
      assert.equal(await store.withConnection(scope, async ({ latestAttempt }) => latestAttempt({ after: attempt.expiresAt })), null);
      assert.equal(await store.withConnection(otherScope, async ({ consumeAttempt }) => consumeAttempt(attempt.state)), null);
      assert.deepEqual(await store.withConnection(scope, async ({ consumeAttempt }) => consumeAttempt(attempt.state)), attempt);
      assert.equal(await store.withConnection(scope, async ({ consumeAttempt }) => consumeAttempt(attempt.state)), null);
      await store.withConnection(scope, async ({ putAttempt, remove }) => {
        await putAttempt(attempt);
        await remove();
      });
      assert.equal(await store.withConnection(scope, async ({ consumeAttempt }) => consumeAttempt(attempt.state)), null);
      assert.equal(await store.withConnection(scope, async ({ connection }) => connection), null);
    });

    await t.test("expired attempts can be pruned without deleting a live consent attempt", async () => {
      const before = Date.now();
      await store.withConnection(scope, async ({ putAttempt }) => {
        await putAttempt({ state: "expired", expiresAt: before - 1 });
        await putAttempt({ state: "live", expiresAt: before + 60_000 });
      });
      assert.equal(await store.pruneExpiredAttempts({ before }), 1);
      assert.equal(await store.withConnection(scope, async ({ consumeAttempt }) => consumeAttempt("expired")), null);
      assert.equal((await store.withConnection(scope, async ({ consumeAttempt }) => consumeAttempt("live"))).state, "live");
    });

    await t.test("the actual CLI source connects, survives restart, reads data and disconnects", { timeout: 20_000 }, async () => {
      const example = new URL("../../connector-google-calendar/patterns/calendar-cli/example/", import.meta.url);
      const directory = await mkdtemp(join(tmpdir(), "connector-cli-"));
      const listener = createServer();
      listener.listen(0, "127.0.0.1");
      await once(listener, "listening");
      const port = listener.address().port;
      await new Promise((resolve) => listener.close(resolve));
      const env = { ...process.env,
        DATABASE_URL: databaseUrl,
        GOOGLE_CLIENT_SECRET: "test-only-client-secret",
        GOOGLE_CALLBACK_URL: `http://127.0.0.1:${port}/connections/google/callback`,
        CONNECTOR_STORAGE_KEY: randomBytes(32).toString("base64"),
        CONNECTOR_APPLICATION_ID: "cli-example", CONNECTOR_SUBJECT_ID: "local-operator"
      };
      const mock = join(directory, "provider-response.mjs");
      await writeFile(mock, `globalThis.fetch = async (url) => {
        if (String(url) === "https://oauth2.googleapis.com/token") return Response.json({ token_type: "Bearer", access_token: "test-access", refresh_token: "test-refresh", expires_in: 3600 });
        if (new URL(url).origin !== "https://www.googleapis.com") throw new Error("Unexpected test network request");
        return Response.json({ kind: String(url).includes("/events") ? "calendar#events" : "calendar#calendarList", items: [{ id: "calendar-item" }] });
      };`, { mode: 0o600 });
      await writeFile(join(directory, "integrations.json"), await readFile(new URL("integrations.json", example)));
      const children = [];
      function start(command) {
        const child = spawn(process.execPath, ["--import", mock, fileURLToPath(new URL("scripts/calendar.js", example)), command], { cwd: directory, env });
        children.push(child);
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (data) => { stdout += data; });
        child.stderr.on("data", (data) => { stderr += data; });
        const closed = once(child, "close").then(([code]) => {
          assert.equal(code, 0, stderr);
          return stdout;
        });
        return { child, closed };
      }
      try {
        assert.match(await start("validate").closed, /configuration is valid/u);
        const connecting = start("connect");
        const authorization = new Promise((resolve, reject) => {
          let output = "";
          connecting.child.stdout.on("data", (data) => {
            output += data;
            const match = output.match(/https:\/\/accounts\.google\.com\/[^\s]+/u);
            if (match) resolve(new URL(match[0]));
          });
          connecting.child.once("error", reject);
          connecting.child.once("close", () => reject(new Error("CLI exited before authorization started.")));
        });
        const url = await authorization;
        const callback = new URL(env.GOOGLE_CALLBACK_URL);
        callback.searchParams.set("code", "test-code");
        callback.searchParams.set("state", url.searchParams.get("state"));
        assert.equal((await fetch(callback)).status, 200);
        assert.match(await connecting.closed, /"status": "connected"/u);
        assert.match(await start("status").closed, /"status": "connected"/u);
        const events = await start("events").closed;
        assert.match(events, /calendar-item/u);
        assert.equal(events.includes("test-access"), false);
        assert.match(await start("disconnect").closed, /"status": "disconnected"/u);
        assert.match(await start("status").closed, /"status": "disconnected"/u);
      } finally {
        for (const child of children) if (child.exitCode === null) child.kill();
        await rm(directory, { recursive: true, force: true });
      }
    });
  } finally {
    await migration.down(knex);
    await knex.destroy();
  }
});
