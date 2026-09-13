import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { asanaProvider } from "../src/server/asana.js";

test("Asana creates a private project, explicitly shares it, tracks tasks and preserves sparse changes", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "asana-repair-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const state = { status: 200, response: { data: [{ gid: "123" }] }, fail: false, deny: false, key: "asana-fixture" };
  const identity = { context: { applicationId: "work-app", subjectId: "workspace" }, integrationId: "work" };
  const service = createConnectionService({ configuration: { schemaVersion: 1, registrations: {}, integrations: {
    work: { provider: "asana", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:ASANA_API_KEY" } }
  } }, providers: [asanaProvider], authorize: async context => { if (state.deny) throw new Error("forbidden"); return context; },
  resolveReference: async () => state.key,
  store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(4) }, activeKeyId: "current" }) }),
  fetchImpl: async (url, init) => { requests.push({ url: new URL(url), init });
    if (state.fail) throw new Error("uncertain provider result");
    return Response.json(state.response, { status: state.status }); }
  });
  const invoke = (operation, input) => service.invoke({ ...identity, operation, input });
  await service.connectApiKey(identity);
  assert.equal(requests[0].url.pathname, "/api/1.0/workspaces");
  for (const [operation, input, endpoint] of [
    ["projects.list", { workspace: "123", archived: false }, "projects"],
    ["users.list", { workspace: "123" }, "workspaces/123/users"],
    ["teams.list", { workspace: "123" }, "workspaces/123/teams"],
    ["tasks.list", { project: "456", completed_since: "now" }, "projects/456/tasks"]
  ]) {
    state.response = { data: [{ gid: "456" }], next_page: { offset: "next & page", uri: "https://untrusted.invalid/page" } };
    assert.deepEqual(await invoke(operation, input), state.response);
    assert.equal(requests.at(-1).url.pathname, `/api/1.0/${endpoint}`);
    await invoke(operation, { ...input, offset: "next & page" });
    assert.equal(requests.at(-1).url.origin, "https://app.asana.com");
    assert.equal(requests.at(-1).url.searchParams.get("offset"), "next & page");
    if (operation === "tasks.list") assert.ok(requests.at(-1).url.searchParams.get("opt_fields").includes("completed"));
  }
  for (const [operation, input, method, endpoint, data] of [
    ["projects.create", { name: "Launch", workspace: "123", privacy_setting: "private" }, "POST", "projects", { name: "Launch", workspace: "123", privacy_setting: "private" }],
    ["projectMembers.add", { project: "456", member: "789", access_level: "editor" }, "POST", "memberships", { parent: "456", member: "789", access_level: "editor" }],
    ["projects.update", { gid: "456", archived: false, notes: "" }, "PUT", "projects/456", { archived: false, notes: "" }],
    ["tasks.create", { name: "Publish", workspace: "123", projects: ["456"], assignee: "789", due_on: "2026-12-31" }, "POST", "tasks", { name: "Publish", workspace: "123", projects: ["456"], assignee: "789", due_on: "2026-12-31" }],
    ["tasks.update", { gid: "900", completed: true }, "PUT", "tasks/900", { completed: true }],
    ["tasks.update", { gid: "900", completed: false, assignee: null, start_on: null, due_on: null }, "PUT", "tasks/900", { completed: false, assignee: null, start_on: null, due_on: null }]
  ]) {
    state.response = { data: { gid: "900", ...data } };
    assert.deepEqual(await invoke(operation, input), state.response);
    const request = requests.at(-1);
    assert.equal(request.url.pathname, `/api/1.0/${endpoint}`);
    assert.equal(request.init.method, method);
    assert.deepEqual(JSON.parse(request.init.body), { data });
    assert.equal(new Headers(request.init.headers).get("authorization"), "Bearer asana-fixture");
    assert.equal(request.init.redirect, "error");
  }
  for (const operation of ["tasks.get", "projects.get"]) {
    state.response = { data: { gid: "900", name: "Fixture" } };
    assert.deepEqual(await invoke(operation, { gid: "900" }), state.response);
  }
  const beforeInvalid = requests.length;
  for (const [operation, input] of [
    ["projects.create", { name: "Launch", workspace: "123" }],
    ["projects.update", { gid: "456" }], ["tasks.get", { gid: "../secrets" }],
    ["tasks.update", { gid: "900", start_on: "2026-09-12" }],
    ["tasks.update", { gid: "900", due_on: "2026-02-30" }],
    ["projects.update", { gid: "456", start_on: "2026-12-31", due_on: "2026-12-31" }],
    ["tasks.update", { gid: "900", projects: ["456"] }],
    ["projectMembers.add", { project: "456", member: "789", access_level: "owner" }]
  ]) await assert.rejects(invoke(operation, input));
  state.deny = true;
  await assert.rejects(invoke("tasks.update", { gid: "900", completed: true }));
  state.deny = false;
  await assert.rejects(service.invoke({ ...identity, context: { ...identity.context, applicationId: "other" }, operation: "workspaces.list" }));
  assert.equal(requests.length, beforeInvalid);
  state.response = { data: {} };
  await assert.rejects(invoke("tasks.get", { gid: "900" }), { code: "connector_response_invalid" });
  for (const status of [400, 403, 404, 429]) {
    state.status = status; state.response = { errors: [{ message: state.key }] };
    await assert.rejects(invoke("tasks.get", { gid: "900" }), e => !JSON.stringify(e).includes(state.key));
  }
  state.status = 200; state.fail = true;
  const beforeUncertain = requests.length;
  await assert.rejects(invoke("tasks.create", { name: "Publish", workspace: "123" }));
  assert.equal(requests.length, beforeUncertain + 1);
  state.fail = false; state.response = { data: [] }; state.key = "rotated-fixture";
  await invoke("workspaces.list", {});
  assert.equal(new Headers(requests.at(-1).init.headers).get("authorization"), "Bearer rotated-fixture");
  state.status = 401;
  await assert.rejects(invoke("workspaces.list", {}), { code: "connector_reconnect_required" });
  state.status = 200;
  await service.connectApiKey(identity);
  await service.disconnect(identity);
  const afterDisconnect = requests.length;
  await assert.rejects(invoke("tasks.list", { project: "456" }));
  assert.equal(requests.length, afterDisconnect);
});
