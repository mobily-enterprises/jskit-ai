import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { attentionProvider } from "../src/server/attention.js";

test("Attention preserves full call content and supports explicit coaching and organization workflows", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "attention-repair-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const state = { status: 200, response: { data: [] }, fail: false, deny: false };
  const identity = { context: { applicationId: "coaching-app", subjectId: "workspace" }, integrationId: "calls" };
  const service = createConnectionService({ configuration: { schemaVersion: 1, registrations: {}, integrations: {
    calls: { provider: "attention", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:ATTENTION_API_KEY" } }
  } }, providers: [attentionProvider], authorize: async context => { if (state.deny) throw new Error("forbidden"); return context; },
    resolveReference: async () => "attention-fixture-key",
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(3) }, activeKeyId: "current" }) }),
    fetchImpl: async (url, init) => { requests.push({ url: new URL(url), init });
      if (state.fail) throw new Error("uncertain result");
      return state.response === null ? new Response(null, { status: state.status }) : Response.json(state.response, { status: state.status }); }
  });
  const invoke = (operation, input = {}) => service.invoke({ ...identity, operation, input });
  await service.connectApiKey(identity);
  const call = { type: "conversations", id: "call-1", attributes: { title: "Acme discovery", transcriptStatus: "completed",
    transcript: { segments: [{ speaker: "Sam", start: 1.2, text: "We need appointment reminders." }] },
    participants: [{ name: "Sam", email: "sam@example.test" }], scorecardResults: [{ title: "Discovery", summary: { averageScore: 85 } }] } };
  state.response = call;
  assert.deepEqual(await invoke("conversations.get", { id: "call-1" }), call);
  assert.equal(requests.at(-1).url.searchParams.get("detailedTranscript"), "true");
  for (const [operation, input, endpoint] of [
    ["scorecards.list", { page: 2, size: 50 }, "scorecards"],
    ["scorecardItems.list", { id: "score-1" }, "scorecards/score-1/items"],
    ["users.list", { teamUUID: "team-1" }, "organizations/users"],
    ["roles.list", {}, "organizations/roles"], ["teams.list", {}, "organizations/teams"]
  ]) { state.response = { data: [{ uuid: "item-1", title: "Fixture" }], meta: { pageNumber: 2 } };
    assert.deepEqual(await invoke(operation, input), state.response); assert.equal(requests.at(-1).url.pathname, `/v2/${endpoint}`); }
  const scoring = { scorecard_uuid: "score-1", conversation_uuid: "call-1", summary: "Good discovery",
    items: [{ scorecard_item_uuid: "criterion-1", numeric_result: 85, description: "Established needs" }] };
  for (const [operation, method, endpoint, input, response] of [
    ["conversations.update", "PUT", "conversations/call-1", { id: "call-1", title: "Reviewed call", labels: { reviewed: true } }, call],
    ["conversations.archive", "DELETE", "conversations/call-1", { id: "call-1" }, { ...call, attributes: { ...call.attributes, archived: true } }],
    ["conversations.import", "POST", "conversations/import", { userID: "user-1", mediaURL: "https://media.example.test/call.mp4", skipOpportunitiesExport: true }, { uuid: "import-1" }],
    ["snippets.create", "POST", "snippets", { user_uuid: "user-1", conversation_id: "call-1", internal: true, notify_views: false, video: { start_time: 10, end_time: 20 } }, { id: "clip-1", url: "https://app.attention.tech/clip-1" }],
    ["analysis.ask", "POST", "ask_attention/v2", { conversations_ids: ["call-1"], deal_id: "", prompt: "What matters?" }, [{ output: "Appointment reminders", error: "", conversation_id: "call-1" }]],
    ["scorecards.get", "GET", "scorecards/score-1", { id: "score-1" }, { data: { id: "score-1", title: "Discovery" } }],
    ["scorecardResults.create", "POST", "createScorecardResult", scoring, { success: true }],
    ["scorecards.summary", "POST", "scorecards/summary", { scorecardUUID: "score-1", scorecardsItemsUUIDs: ["criterion-1"], teamUUIDs: [], userUUIDs: ["user-1"], fromDateTime: "2026-09-01T00:00:00Z", toDateTime: "2026-09-12T00:00:00Z" }, { data: [{ averageScore: 85 }] }],
    ["users.create", "POST", "organizations/users", { email: "sam@example.test", first_name: "Sam", last_name: "Test", roleUUID: "role-1", teams: [{ uuid: "team-1", primary: true }], seat_type: "listener" }, { data: { uuid: "user-1" } }],
    ["users.update", "PATCH", "organizations/users/user-1", { id: "user-1", firstName: "Samuel", teamUUIDsToRemove: ["old-team"], teamsToAdd: [{ uuid: "team-1", primary: true }] }, { data: { uuid: "user-1" } }],
    ["users.delete", "DELETE", "organizations/users/user-1", { id: "user-1" }, null],
    ["teams.create", "POST", "organizations/teams", { name: "Coaching", parentTeamUUID: "parent-1" }, { data: { uuid: "team-1" } }],
    ["teams.update", "PATCH", "organizations/teams/team-1", { id: "team-1", name: "Sales coaching" }, { data: { uuid: "team-1" } }]
  ]) { state.response = response; assert.deepEqual(await invoke(operation, input).catch(error => { error.message = `${operation}: ${error.message}`; throw error; }), response === null ? {} : response);
    const request = requests.at(-1); assert.equal(request.url.pathname, `/v2/${endpoint}`); assert.equal(request.init.method, method);
    if (!["GET", "DELETE"].includes(method)) { const { id, ...body } = input; assert.deepEqual(JSON.parse(request.init.body), body); }
    assert.equal(new Headers(request.init.headers).get("authorization"), "Bearer attention-fixture-key"); assert.equal(request.init.redirect, "error");
  }
  const before = requests.length;
  for (const [operation, input] of [
    ["conversations.get", { id: "../../other" }], ["conversations.update", { id: "call-1" }],
    ["conversations.import", { mediaURL: "http://localhost/file", userID: "user-1" }],
    ["snippets.create", { user_uuid: "user-1", conversation_id: "call-1", internal: true, notify_views: false, video: { start_time: 20, end_time: 10 } }],
    ["scorecardResults.create", { ...scoring, items: [{ description: "Missing criterion" }] }],
    ["users.create", { email: "sam@example.test", first_name: "Sam", last_name: "Test", roleUUID: "role-1", teams: [] }],
    ["teams.update", { id: "team-1" }]
  ]) await assert.rejects(invoke(operation, input));
  state.deny = true; await assert.rejects(invoke("users.delete", { id: "user-1" })); state.deny = false;
  assert.equal(requests.length, before);
  state.response = { wrong: true }; await assert.rejects(invoke("conversations.get", { id: "call-1" }), { code: "connector_response_invalid" });
  state.response = { success: false }; await assert.rejects(invoke("scorecardResults.create", scoring), { code: "connector_response_invalid" });
  state.response = [{ conversation_id: "call-1", output: "", error: "Transcript pending" }];
  assert.equal((await invoke("analysis.ask", { conversations_ids: ["call-1"], deal_id: "", prompt: "Summarize" }))[0].error, "Transcript pending");
  for (const status of [403, 429]) { state.status = status; await assert.rejects(invoke("teams.list")); }
  state.status = 200; state.fail = true; const uncertain = requests.length;
  await assert.rejects(invoke("scorecardResults.create", scoring)); assert.equal(requests.length, uncertain + 1);
});
