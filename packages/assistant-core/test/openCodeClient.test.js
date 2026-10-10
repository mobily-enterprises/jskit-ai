import assert from "node:assert/strict";
import test from "node:test";

import {
  OPENCODE_RESPONSE_LIMIT_BYTES,
  createOpenCodeServerClient
} from "../src/server/conversation/openCodeClient.js";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status
  });
}

test("OpenCode directory readiness uses the same authenticated directory as native Stop", async () => {
  const requests = [];
  const client = createOpenCodeServerClient({ baseUrl: "http://127.0.0.1:4096", password: "private",
    fetchImpl: async (url, init) => {
      requests.push({ path: new URL(url).pathname, headers: init.headers, signal: init.signal });
      return jsonResponse(new URL(url).pathname === "/path" ? { directory: "/work/selected" } : true);
    }
  }).forDirectory("/work/selected");
  const stopSignal = new AbortController().signal;
  await client.prepareDirectory();
  assert.equal(await client.interrupt("retained", { signal: stopSignal }), true);
  assert.deepEqual(requests.map(row => row.path), ["/path", "/session/retained/abort"]);
  assert.equal(requests[0].headers.authorization, requests[1].headers.authorization);
  assert.equal(requests[0].headers["x-opencode-directory"], "/work/selected");
  assert.equal(requests[1].headers["x-opencode-directory"], "/work/selected");
  assert.ok(requests[0].signal instanceof AbortSignal);
  assert.equal(requests[1].signal, stopSignal);
});

test("OpenCode directory readiness rejects cancellation and missing native confirmation", async () => {
  const client = createOpenCodeServerClient({ baseUrl: "http://127.0.0.1:4096",
    fetchImpl: async () => jsonResponse({ healthy: true }) });
  await assert.rejects(client.prepareDirectory(), { code: "assistant_opencode_directory_unavailable" });
  const failure = new Error("Closed during native preparation");
  await assert.rejects(client.prepareDirectory({ signal: AbortSignal.abort(failure) }), error => error === failure);
});

test("OpenCode attachment access persists on its conversation, preserves other permissions and does not grow on retries", async () => {
  const initial = [{ permission: "read", pattern: "*.env", action: "deny" }];
  let permission = [...initial];
  const requests = [];
  const client = createOpenCodeServerClient({
    allowAttachmentDirectories: true,
    baseUrl: "http://127.0.0.1:4096",
    fetchImpl: async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : null;
      requests.push({ path: new URL(url).pathname, method: init.method, body });
      if (init.method === "PATCH") permission = body.permission;
      return jsonResponse({ permission });
    }
  });
  const attachments = [
    { path: "/sessions/one/artifacts/attachments/id-1/file", fileName: "image.png", contentType: "image/png" },
    { path: "/sessions/one/artifacts/attachments/id-2/file", fileName: "data.csv", contentType: "application/octet-stream" }
  ];
  await client.prompt("ses_one", { prompt: { text: "Inspect" }, attachments });
  assert.deepEqual(permission, [...initial, ...attachments.map((attachment) => ({
    permission: "external_directory", pattern: attachment.path.replace(/file$/u, "*"), action: "allow"
  }))]);
  assert.deepEqual(requests.map(({ method, path }) => [method, path]), [
    ["GET", "/session/ses_one"], ["PATCH", "/session/ses_one"], ["POST", "/session/ses_one/prompt_async"]
  ]);
  await client.prompt("ses_one", { prompt: { text: "Retry" }, attachments });
  assert.equal(requests.filter(({ method }) => method === "PATCH").length, 1);
  requests.length = 0;
  await client.prompt("ses_one", { prompt: { text: "Reopen the earlier file" } });
  assert.equal(requests.length, 1);
  assert.equal(permission.length, 3);
});

test("OpenCode does not send attachments if their native access cannot be configured", async () => {
  const requests = [];
  const client = createOpenCodeServerClient({
    allowAttachmentDirectories: true,
    baseUrl: "http://127.0.0.1:4096",
    fetchImpl: async (_url, init) => {
      requests.push(init.method);
      return init.method === "GET" ? jsonResponse({ permission: [] }) : jsonResponse({ message: "Cannot save permissions" }, 500);
    }
  });
  await assert.rejects(client.prompt("ses_one", {
    prompt: { text: "Inspect" },
    attachments: [{ path: "/sessions/one/artifacts/attachments/id/file", fileName: "data.csv" }]
  }), /Cannot save permissions/u);
  assert.deepEqual(requests, ["GET", "PATCH"]);
});

test("OpenCode client accepts only loopback HTTP origins", () => {
  for (const baseUrl of [
    "https://127.0.0.1:4096",
    "http://192.0.2.10:4096",
    "http://example.com:4096"
  ]) {
    assert.throws(
      () => createOpenCodeServerClient({
        allowAttachmentDirectories: true,
        baseUrl
      }),
      /loopback HTTP server/u
    );
  }
  assert.doesNotThrow(() => createOpenCodeServerClient({
    allowAttachmentDirectories: true,
    baseUrl: "http://127.0.0.1:4096"
  }));
});

test("OpenCode provider reads allowlist catalogue metadata before it can be cached", async () => {
  const secret = "provider-secret-canary";
  const client = createOpenCodeServerClient({
    allowAttachmentDirectories: true,
    baseUrl: "http://127.0.0.1:4096",
    fetchImpl: async () => jsonResponse({
      all: [{
        api: { url: `https://${secret}.example` },
        headers: { authorization: secret },
        id: "zai",
        key: secret,
        env: ["ZAI_API_KEY"],
        models: {
          "glm-4.7-flash": {
            api: { headers: { authorization: secret }, url: `https://${secret}.example/v1` },
            capabilities: {
              attachment: true,
              input: { image: true, secret },
              output: { text: true },
              reasoning: true,
              toolcall: true
            },
            family: "glm",
            headers: { authorization: secret },
            id: "glm-4.7-flash",
            limit: { context: 204800, output: 131072, secret },
            name: "GLM Flash",
            options: { apiKey: secret },
            release_date: "2026-08-01",
            status: "active",
            variants: { high: { apiKey: secret } }
          }
        },
        name: "Z.AI",
        options: { apiKey: secret },
        source: "api"
      }],
      apiKey: secret,
      connected: ["zai"],
      default: { zai: "glm-4.7-flash" }
    }),
    password: "bridge-password"
  });

  const providers = await client.providers();

  assert.deepEqual(providers, {
    all: [{
      apiKeyCompatible: true,
      id: "zai",
      models: {
        "glm-4.7-flash": {
          capabilities: {
            attachment: true,
            input: { image: true },
            output: { text: true },
            reasoning: true,
            toolcall: true
          },
          family: "glm",
          id: "glm-4.7-flash",
          limit: { context: 204800, output: 131072 },
          name: "GLM Flash",
          release_date: "2026-08-01",
          status: "active",
          variants: { high: {} }
        }
      },
      name: "Z.AI"
    }],
    default: { zai: "glm-4.7-flash" }
  });
  assert.equal(JSON.stringify(providers).includes(secret), false);
  assert.equal(Object.hasOwn(providers, "connected"), false);
});

test("OpenCode provider reads expose only API-key compatibility from raw env metadata", async () => {
  const provider = (id, env) => ({ env, id, models: {}, name: id });
  const client = createOpenCodeServerClient({
    allowAttachmentDirectories: true,
    baseUrl: "http://127.0.0.1:4096",
    fetchImpl: async () => jsonResponse({
      all: [
        provider("azure", ["AZURE_RESOURCE_NAME", "AZURE_API_KEY"]),
        provider("cloudflare-workers-ai", [
          "CLOUDFLARE_ACCOUNT_ID",
          "CLOUDFLARE_API_TOKEN"
        ]),
        provider("google", ["GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CLOUD_PROJECT"]),
        provider("amazon-bedrock", ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]),
        provider("ordinary", ["ORDINARY_API_KEY"])
      ],
      default: {}
    }),
    password: "bridge-password"
  });

  const providers = await client.providers();

  assert.deepEqual(providers.all.map(({ apiKeyCompatible, id }) => ({
    apiKeyCompatible,
    id
  })), [
    { apiKeyCompatible: false, id: "azure" },
    { apiKeyCompatible: false, id: "cloudflare-workers-ai" },
    { apiKeyCompatible: true, id: "google" },
    { apiKeyCompatible: true, id: "amazon-bedrock" },
    { apiKeyCompatible: true, id: "ordinary" }
  ]);
  assert.equal(providers.all.length, 5);
  assert.equal(JSON.stringify(providers).includes("AZURE_API_KEY"), false);
  assert.equal(JSON.stringify(providers).includes("AWS_SECRET_ACCESS_KEY"), false);
});

test("OpenCode provider reads reject malformed or empty catalogues", async () => {
  for (const value of [null, {}, { all: {} }, { all: [] }, { all: [null] }]) {
    const client = createOpenCodeServerClient({
      allowAttachmentDirectories: true,
      baseUrl: "http://127.0.0.1:4096",
      fetchImpl: async () => jsonResponse(value),
      password: "bridge-password"
    });
    await assert.rejects(
      () => client.providers(),
      (error) => error?.code === "assistant_opencode_catalog_invalid"
    );
  }
});

test("OpenCode project clients scope every request to one directory", async () => {
  const requests = [];
  const client = createOpenCodeServerClient({
    allowAttachmentDirectories: true,
    baseUrl: "http://127.0.0.1:4096",
    fetchImpl: async (url, options = {}) => {
      requests.push({ headers: { ...options.headers }, url: String(url) });
      return jsonResponse(new URL(url).pathname === "/api/session"
        ? { data: { id: "ses_scoped" } }
        : true);
    },
    password: "bridge-password"
  }).forDirectory("/workspace/project-one");

  await client.createSession({ id: "ses_scoped" });
  await client.readSession("ses_scoped");
  await client.interrupt("ses_scoped");

  assert.deepEqual(
    requests.map(({ headers }) => headers["x-opencode-directory"]),
    ["/workspace/project-one", "/workspace/project-one", "/workspace/project-one"]
  );
});

test("OpenCode client combines durable v2 sessions with stable execution routes and isolates provider keys", async () => {
  const requests = [];
  const client = createOpenCodeServerClient({
    allowAttachmentDirectories: true,
    baseUrl: "http://127.0.0.1:4096",
    fetchImpl: async (url, options = {}) => {
      requests.push({
        body: options.body,
        headers: { ...options.headers },
        method: options.method,
        url: String(url)
      });
      const pathname = new URL(url).pathname;
      if (pathname === "/api/session") {
        return jsonResponse({ data: { id: "ses_created" } });
      }
      if (pathname.endsWith("/prompt_async")) {
        return new Response(null, { status: 204 });
      }
      if (pathname.endsWith("/message")) {
        return jsonResponse([{
          info: {
            finish: "stop",
            id: "msg_assistant",
            role: "assistant",
            time: { completed: 2, created: 1 }
          },
          parts: [{ id: "prt_text", text: "hello", type: "text" }]
        }]);
      }
      return jsonResponse(true);
    },
    password: "bridge-password"
  });

  await client.authenticateApiKey("deepseek", "deepseek-private-key");
  assert.deepEqual(await client.createSession({ id: "ses_created" }), { id: "ses_created" });
  assert.deepEqual(await client.prompt("ses/needs encoding", {
    agent: "build",
    id: "msg_admitted",
    model: { id: "deepseek-chat", providerID: "deepseek", variant: "high" },
    prompt: { text: "  hello\n" }
  }), {
    delivery: "",
    id: "msg_admitted",
    sessionID: "ses/needs encoding"
  });
  assert.deepEqual(await client.messages("ses_created", { limit: 10 }), {
    data: [{
      content: [{ id: "prt_text", text: "hello", type: "text" }],
      finish: "stop",
      id: "msg_assistant",
      role: "assistant",
      time: { completed: 2, created: 1 },
      type: "assistant"
    }]
  });
  await client.interrupt("ses_created");
  await client.switchAgent("ses_created", "build");
  await client.switchModel("ses_created", { id: "deepseek-chat", providerID: "deepseek" });

  assert.deepEqual(requests.map(({ method, url }) => ({
    method,
    path: new URL(url).pathname
  })), [
    { method: "PUT", path: "/auth/deepseek" },
    { method: "POST", path: "/api/session" },
    { method: "POST", path: "/session/ses%2Fneeds%20encoding/prompt_async" },
    { method: "GET", path: "/session/ses_created/message" },
    { method: "POST", path: "/session/ses_created/abort" },
    { method: "POST", path: "/api/session/ses_created/agent" },
    { method: "POST", path: "/api/session/ses_created/model" }
  ]);
  assert.deepEqual(JSON.parse(requests[0].body), {
    key: "deepseek-private-key",
    type: "api"
  });
  assert.deepEqual(JSON.parse(requests[2].body), {
    agent: "build",
    messageID: "msg_admitted",
    model: { modelID: "deepseek-chat", providerID: "deepseek" },
    parts: [{ text: "  hello\n", type: "text" }],
    variant: "high"
  });
  assert.equal(requests.slice(1).some((request) => (
    JSON.stringify(request).includes("deepseek-private-key")
  )), false);
  assert.equal(new Set(requests.map((request) => request.headers.authorization)).size, 1);
  assert.match(requests[0].headers.authorization, /^Basic /u);
});

test("OpenCode client rejects oversized responses before parsing them", async () => {
  const client = createOpenCodeServerClient({
    allowAttachmentDirectories: true,
    baseUrl: "http://localhost:4096",
    fetchImpl: async () => new Response("x".repeat(OPENCODE_RESPONSE_LIMIT_BYTES + 1)),
    password: "password"
  });
  await assert.rejects(
    () => client.health(),
    (error) => error?.code === "assistant_opencode_response_too_large"
  );
});

test("OpenCode client decodes bounded server-sent events", async () => {
  const source = [
    ": heartbeat",
    "id: evt_1",
    "event: session.updated",
    'data: {"sessionID":"ses_1"}',
    "",
    "id: evt_2",
    'data: "{\\"status\\":\\"idle\\"}"',
    ""
  ].join("\n");
  let eventUrl = "";
  const client = createOpenCodeServerClient({
    allowAttachmentDirectories: true,
    baseUrl: "http://[::1]:4096",
    fetchImpl: async (url) => {
      eventUrl = String(url);
      return new Response(source, {
        headers: { "content-type": "text/event-stream" }
      });
    },
    password: "password"
  });
  const events = [];
  let ready = false;
  for await (const event of client.events("ses_1", { onReady: () => { ready = true; } })) {
    assert.equal(ready, true);
    events.push(event);
  }
  assert.deepEqual(events, [
    {
      data: { sessionID: "ses_1" },
      event: "session.updated",
      id: "evt_1"
    },
    {
      data: { status: "idle" },
      event: "message",
      id: "evt_2"
    }
  ]);
  assert.equal(new URL(eventUrl).pathname, "/event");
});

test("OpenCode session status reads native busy state and treats an omitted session as idle", async () => {
  const client = createOpenCodeServerClient({
    allowAttachmentDirectories: true,
    baseUrl: "http://127.0.0.1:4096",
    fetchImpl: async (url) => {
      assert.equal(new URL(url).pathname, "/session/status");
      return jsonResponse({ ses_busy: { type: "busy" } });
    }
  });
  assert.deepEqual(await client.sessionStatus("ses_busy"), { type: "busy" });
  assert.deepEqual(await client.sessionStatus("ses_other"), { type: "idle" });
});


test("OpenCode retained storage validates complete inventories and bounded cancellable pages without opening archived source", async () => {
  const password = "storage-proof";
  const pageRequests = [];
  const permissionUpdates = [];
  const existingPermission = { permission: "bash", pattern: "*", action: "ask" };
  let conversationPermission = [existingPermission];
  let messageResponse = () => new Response("[]");
  let inventoryRows = [{ id: "ses_child", parentID: "ses_parent", directory: "/archived/source" }];
  const client = createOpenCodeServerClient({ baseUrl: "http://127.0.0.1:12345", password, directory: "/deleted/worktree",
    fetchImpl: async (url, options) => {
      assert.equal(options.headers["x-opencode-directory"], undefined, "Storage must not initialize the archived source directory");
      if (new URL(url).pathname.endsWith("/message")) {
        assert.equal(options.headers.authorization, `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`);
        assert.equal(options.method, "GET");
        pageRequests.push(new URL(url));
        return messageResponse(options);
      }
      if (new URL(url).pathname === "/experimental/session") {
        assert.deepEqual(Object.fromEntries(new URL(url).searchParams), { directory: "/archived/source", limit: "1001" });
      }
      if (new URL(url).pathname === "/session/ses_parent") {
        assert.equal(options.headers.authorization, `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`);
        if (options.method === "PATCH") {
          assert.equal(options.headers["content-type"], "application/json");
          conversationPermission = JSON.parse(options.body).permission;
          permissionUpdates.push(conversationPermission);
          return new Response(null, { status: 204 });
        }
        return new Response(JSON.stringify({ id: "ses_parent", directory: "/archived/source", permission: conversationPermission }), { status: 200 });
      }
      if (new URL(url).pathname.startsWith("/session") || new URL(url).pathname === "/experimental/session") {
        assert.equal(options.headers.authorization, `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`);
        assert.equal(options.method, "GET");
        return new Response(JSON.stringify(inventoryRows), { status: 200 });
      }
      throw new Error("Unexpected storage request");
    }
  });
  assert.deepEqual(await client.readConversationStorage("ses_parent"), { id: "ses_parent", directory: "/archived/source", permission: [existingPermission] });
  const terminalAttachment = { path: "/session-artifacts/attachments/file-1/file" };
  await client.allowConversationAttachments("ses_parent", [terminalAttachment]);
  assert.deepEqual(permissionUpdates, [[existingPermission, {
    permission: "external_directory", pattern: "/session-artifacts/attachments/file-1/*", action: "allow"
  }]]);
  await client.allowConversationAttachments("ses_parent", [terminalAttachment]);
  assert.equal(permissionUpdates.length, 1);
  await assert.rejects(client.allowConversationAttachments("../credentials", [terminalAttachment]), /Invalid/);
  await assert.rejects(client.readConversationStorage("../credentials"), /Invalid/);
  assert.deepEqual(await client.listConversationChildren("ses_parent"), inventoryRows);
  assert.deepEqual(await client.listConversationsForDirectory("/archived/source"), inventoryRows);
  await assert.rejects(client.listConversationChildren("../credentials"), /Invalid/);
  inventoryRows = [{ id: "ses_child", parentID: "ses_foreign", directory: "/archived/source" }];
  await assert.rejects(client.listConversationChildren("ses_parent"), /invalid child inventory/);
  inventoryRows = Array.from({ length: 1001 }, (_, index) => ({ id: `ses_${index}`, directory: "/archived/source" }));
  await assert.rejects(client.listConversationsForDirectory("/archived/source"), /incomplete or invalid/);
  assert.deepEqual(await client.readConversationStoragePage("ses_parent"), { data: [], nextCursor: null });
  messageResponse = () => new Response("[]", { headers: { "x-next-cursor": "opaque+/=" } });
  assert.equal((await client.readConversationStoragePage("ses_parent", { before: "opaque+/=" })).nextCursor, "opaque+/=");
  assert.equal(pageRequests[0].pathname, "/session/ses_parent/message");
  assert.deepEqual(Object.fromEntries(pageRequests[0].searchParams), { limit: "1" });
  assert.deepEqual(Object.fromEntries(pageRequests[1].searchParams), { limit: "1", before: "opaque+/=" });
  await assert.rejects(client.readConversationStoragePage("../credentials"), /Invalid/);
  await assert.rejects(client.readConversationStoragePage("ses_parent", { signal: AbortSignal.abort() }), { name: "AbortError" });
  assert.equal(pageRequests.length, 2);
  const largeMessage = { info: { id: "msg_large", role: "user" }, parts: [{ type: "text", text: "x".repeat(3 * 1024 * 1024) }] };
  messageResponse = () => new Response(JSON.stringify([largeMessage]));
  assert.deepEqual(await client.readConversationStoragePage("ses_parent"), { data: [largeMessage], nextCursor: null });
  messageResponse = () => new Response("[]", { headers: { link: '<http://localhost/session/ses_parent/message?before=opaque>; rel="next"' } });
  await assert.rejects(client.readConversationStoragePage("ses_parent"), /continuation cursor/);
  let bodyCancelled = false;
  messageResponse = () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { bodyCancelled = true; }
  }));
  await assert.rejects(client.readConversationStoragePage("ses_parent"), { code: "assistant_opencode_response_too_large" });
  assert.equal(bodyCancelled, true);
  const started = Promise.withResolvers();
  const cancellation = new AbortController();
  messageResponse = ({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    started.resolve();
  });
  const cancelledPage = client.readConversationStoragePage("ses_parent", { signal: cancellation.signal });
  await started.promise;
  cancellation.abort();
  await assert.rejects(cancelledPage, { name: "AbortError" });

});


test("stopped OpenCode native database retains the original MessageV2 projection without native writes", async t => {
  const { mkdtemp, readFile, lstat, readdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { DatabaseSync } = await import("node:sqlite");
  const { readOpenCodeConversationDatabase } = await import("../src/server/hosts/openCodeClient.js");
  const { readStoppedNativeDatabase } = await import("../src/server/hosts/nativeHistory.js");
  const root = await mkdtemp(path.join(tmpdir(), "assistant-native-opencode-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "native space.db");
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, project_id TEXT);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT);
    CREATE TABLE session_input (session_id TEXT, promoted_seq INTEGER);`);
  db.prepare("INSERT INTO session VALUES (?, ?, ?)").run("ses_original", "/private/actor/colleague_scope", "project_original");
  const insert = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)");
  insert.run("msg_original_user", "ses_original", 1, JSON.stringify({ id: "untrusted-payload-id", role: "user", time: { created: 1 } }));
  insert.run("msg_original_answer", "ses_original", 2, JSON.stringify({ role: "assistant", parentID: "msg_original_user", finish: "stop", time: { created: 2, completed: 3 } }));
  db.prepare("INSERT INTO part VALUES (?, ?, ?, ?)").run("prt_original_text", "msg_original_answer", "ses_original",
    JSON.stringify({ type: "text", text: "Exact answer 🦊", id: "untrusted-part-id" }));
  db.close();
  const before = await readFile(file);
  const stat = await lstat(file);
  const messages = [];
  const result = await readOpenCodeConversationDatabase({ databasePath: file, conversationId: "ses_original", onMessage: row => messages.push(row) });
  assert.equal(result.session.directory, "/private/actor/colleague_scope");
  assert.equal(result.session.project_id, "project_original");
  assert.equal(result.recordCount, 2);
  assert.match(result.revision, /^[a-f0-9]{64}$/u);
  assert.deepEqual(messages.map(row => [row.id, row.sessionID, row.type]), [
    ["msg_original_user", "ses_original", "user"], ["msg_original_answer", "ses_original", "assistant"]
  ]);
  assert.equal(messages[1].parentID, "msg_original_user");
  assert.deepEqual(messages[1].content, [{ type: "text", text: "Exact answer 🦊", id: "prt_original_text", sessionID: "ses_original", messageID: "msg_original_answer" }]);
  await assert.rejects(readStoppedNativeDatabase(file, database => database.exec("DELETE FROM message")), /readonly|read-only/iu);
  const cancelled = new Error("Caller stopped original inspection");
  await assert.rejects(readOpenCodeConversationDatabase({ databasePath: file, conversationId: "ses_original", onMessage() {}, signal: AbortSignal.abort(cancelled) }), error => error === cancelled);
  assert.deepEqual(await readFile(file), before);
  const after = await lstat(file);
  for (const key of ["dev", "ino", "size", "mtimeMs", "ctimeMs", "mode"]) assert.equal(after[key], stat[key]);
  assert.deepEqual(await readdir(root), ["native space.db"]);
});

test("stopped OpenCode database refuses pending native work and foreign parts with no storage changes", async t => {
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { DatabaseSync } = await import("node:sqlite");
  const { readOpenCodeConversationDatabase } = await import("../src/server/hosts/openCodeClient.js");
  const root = await mkdtemp(path.join(tmpdir(), "assistant-native-opencode-refusal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "native.db");
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT);
    CREATE TABLE session_input (session_id TEXT, promoted_seq INTEGER);
    INSERT INTO session VALUES ('ses_original', '/private/actor/scope');
    INSERT INTO session_input VALUES ('ses_original', NULL);`);
  db.close();
  let seen = 0;
  const before = await readFile(file);
  await assert.rejects(readOpenCodeConversationDatabase({ databasePath: file, conversationId: "ses_original", onMessage() { seen += 1; } }), /unpromoted native request/u);
  assert.equal(seen, 0);
  assert.deepEqual(await readFile(file), before);
  const edited = new DatabaseSync(file);
  edited.exec("DELETE FROM session_input");
  edited.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run("msg_original", "ses_original", 1, JSON.stringify({ role: "assistant", finish: "stop" }));
  edited.prepare("INSERT INTO part VALUES (?, ?, ?, ?)").run("prt_foreign", "msg_original", "ses_other", JSON.stringify({ type: "text", text: "Other private owner" }));
  edited.close();
  const foreignBefore = await readFile(file);
  await assert.rejects(readOpenCodeConversationDatabase({ databasePath: file, conversationId: "ses_original", onMessage() { seen += 1; } }), /could not be inspected completely/u);
  assert.equal(seen, 0);
  assert.deepEqual(await readFile(file), foreignBefore);
});

test("stopped native inspection rejects live journals and noncanonical files before opening storage", async t => {
  const { mkdtemp, readFile, writeFile, readdir, symlink, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { DatabaseSync } = await import("node:sqlite");
  const { readStoppedNativeDatabase } = await import("../src/server/hosts/nativeHistory.js");
  const root = await mkdtemp(path.join(tmpdir(), "assistant-native-journal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "native.db");
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE retained (id TEXT)");
  db.close();
  const before = await readFile(file);
  const sidecar = Buffer.from("Uncheckpointed native storage, retained exactly");
  await writeFile(`${file}-wal`, sidecar);
  let read = false;
  await assert.rejects(readStoppedNativeDatabase(file, () => { read = true; }), /journal sidecar/u);
  assert.equal(read, false);
  assert.deepEqual(await readFile(file), before);
  assert.deepEqual(await readFile(`${file}-wal`), sidecar);
  await symlink(file, path.join(root, "link.db"));
  await assert.rejects(readStoppedNativeDatabase(path.join(root, "link.db"), () => { read = true; }), /regular file.*canonical path/u);
  assert.equal(read, false);
  assert.deepEqual((await readdir(root)).sort(), ["link.db", "native.db", "native.db-wal"]);
});


test("stopped native WAL inspection reads newest committed OpenCode rows without changing native files and removes private snapshots", async t => {
  const { mkdtemp, readFile, writeFile, lstat, readdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { DatabaseSync } = await import("node:sqlite");
  const { readOpenCodeConversationDatabase } = await import("../src/server/hosts/openCodeClient.js");
  const { readStoppedNativeDatabase } = await import("../src/server/hosts/nativeHistory.js");
  const root = await mkdtemp(path.join(tmpdir(), "assistant-native-stopped-wal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "native.db");
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT);
    INSERT INTO session VALUES ('ses_original', '/private/actor/colleague_scope');`);
  db.close();
  // Leave real committed SQLite WAL frames after the only fixture writer exits.
  // The base contains the schema, but neither of these newly committed messages.
  const writer = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { DatabaseSync } from "node:sqlite";
    const database = new DatabaseSync(process.argv[1]);
    database.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; BEGIN");
    const insert = database.prepare("INSERT INTO message VALUES (?, ?, ?, ?)");
    insert.run("msg_user", "ses_original", 1, JSON.stringify({ role: "user", time: { created: 1 } }));
    insert.run("msg_answer", "ses_original", 2, JSON.stringify({ role: "assistant", parentID: "msg_user", finish: "stop", time: { created: 2, completed: 3 } }));
    database.prepare("INSERT INTO part VALUES (?, ?, ?, ?)").run("prt_text", "msg_answer", "ses_original", JSON.stringify({ type: "text", text: "Newest committed answer 🦊" }));
    database.exec("COMMIT");
    process.kill(process.pid, "SIGKILL");
  `, file], { encoding: "utf8", timeout: 10_000 });
  assert.equal(writer.signal, "SIGKILL", writer.stderr);
  const before = {};
  for (const suffix of ["", "-wal", "-shm"]) before[suffix] = { bytes: await readFile(file + suffix), stat: await lstat(file + suffix) };
  assert.ok(before["-wal"].bytes.length > 32);
  const nativeNames = await readdir(root);
  let snapshot;
  const count = await readStoppedNativeDatabase(file, database => {
    snapshot = database.prepare("PRAGMA database_list").get().file;
    assert.notEqual(snapshot, file, "WAL inspection opens only the private snapshot");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM message").get().count, 2);
    assert.throws(() => database.exec("DELETE FROM message"), /readonly|read-only/iu);
    return 2;
  });
  assert.equal(count, 2);
  await assert.rejects(lstat(path.dirname(snapshot)), { code: "ENOENT" });
  const messages = [];
  const result = await readOpenCodeConversationDatabase({ databasePath: file, conversationId: "ses_original", onMessage: row => messages.push(row) });
  assert.equal(result.recordCount, 2);
  assert.deepEqual(messages.map(row => row.id), ["msg_user", "msg_answer"]);
  assert.equal(messages[1].content[0].text, "Newest committed answer 🦊");
  const cancelled = new Error("Cancel the private stopped snapshot");
  const controller = new AbortController();
  await assert.rejects(readStoppedNativeDatabase(file, database => {
    snapshot = database.prepare("PRAGMA database_list").get().file;
    controller.abort(cancelled);
  }, { signal: controller.signal }), error => error === cancelled);
  await assert.rejects(lstat(path.dirname(snapshot)), { code: "ENOENT" });
  const interruptedProjection = new AbortController();
  await assert.rejects(readOpenCodeConversationDatabase({ databasePath: file, conversationId: "ses_original", signal: interruptedProjection.signal,
    onMessage() { interruptedProjection.abort(cancelled); } }), error => error === cancelled);
  for (const suffix of ["", "-wal", "-shm"]) {
    assert.deepEqual(await readFile(file + suffix), before[suffix].bytes);
    const after = await lstat(file + suffix);
    for (const key of ["dev", "ino", "size", "mtimeMs", "ctimeMs", "mode"]) assert.equal(after[key], before[suffix].stat[key]);
  }
  assert.deepEqual(await readdir(root), nativeNames);
  const invalidWal = Buffer.from(before["-wal"].bytes);
  invalidWal.writeUInt32BE(0, 0);
  await writeFile(file + "-wal", invalidWal);
  let invalidRead = false;
  await assert.rejects(readStoppedNativeDatabase(file, () => { invalidRead = true; }), /journal sidecar/u);
  assert.equal(invalidRead, false, "Malformed paired WAL refuses before the reader callback");
  assert.deepEqual(await readFile(file + "-wal"), invalidWal);
  await writeFile(file + "-wal", before["-wal"].bytes);
  await assert.rejects(readStoppedNativeDatabase(file, async database => {
    snapshot = database.prepare("PRAGMA database_list").get().file;
    await writeFile(file + "-wal", Buffer.concat([before["-wal"].bytes, Buffer.from("Fixture writer changed native storage")]));
  }), /Native storage changed during inspection/u);
  await assert.rejects(lstat(path.dirname(snapshot)), { code: "ENOENT" });
});
