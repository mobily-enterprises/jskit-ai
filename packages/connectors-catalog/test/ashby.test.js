import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { ashbyProvider } from "../src/server/ashby.js";

const id = "11111111-1111-4111-8111-111111111111";
const stage = "22222222-2222-4222-8222-222222222222";
test("Ashby syncs candidates/applications, updates a profile and explicitly advances a sourced application", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "ashby-repair-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const state = { status: 200, response: { success: true, results: [], moreDataAvailable: false }, fail: false, deny: false };
  const identity = { context: { applicationId: "hiring-app", subjectId: "workspace" }, integrationId: "hiring" };
  const service = createConnectionService({ configuration: { schemaVersion: 1, registrations: {}, integrations: {
    hiring: { provider: "ashby", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:ASHBY_API_KEY" } }
  } }, providers: [ashbyProvider], authorize: async context => { if (state.deny) throw new Error("forbidden"); return context; },
  resolveReference: async () => "ashby-fixture-key",
  store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(3) }, activeKeyId: "current" }) }),
  fetchImpl: async (url, init) => { requests.push({ url: new URL(url), init });
    if (state.fail) throw new Error("uncertain result");
    return Response.json(state.response, { status: state.status }); }
  });
  const invoke = (operation, input) => service.invoke({ ...identity, operation, input });
  await service.connectApiKey(identity);
  assert.equal(requests[0].url.pathname, "/job.list");
  for (const [operation, endpoint, input] of [
    ["candidates.list", "candidate.list", {}],
    ["applications.list", "application.list", { jobId: id, status: "Active" }],
    ["interviewPlans.list", "interviewPlan.list", {}]
  ]) {
    state.response = { success: true, results: [{ id }], moreDataAvailable: true, nextCursor: "next & page" };
    assert.deepEqual(await invoke(operation, { ...input, syncToken: "old-checkpoint" }), state.response);
    assert.equal(requests.at(-1).url.pathname, `/${endpoint}`);
    state.response = { success: true, results: [], moreDataAvailable: false, syncToken: "new-checkpoint" };
    assert.equal((await invoke(operation, { ...input, syncToken: "old-checkpoint", cursor: "next & page" })).syncToken, "new-checkpoint");
    const sent = JSON.parse(requests.at(-1).init.body);
    assert.equal(sent.syncToken, "old-checkpoint");
    assert.equal(sent.cursor, "next & page");
  }
  for (const [operation, input, endpoint, body] of [
    ["jobs.get", { id }, "job.info", { id }],
    ["candidates.get", { id }, "candidate.info", { id }],
    ["candidates.create", { name: "Fixture Candidate", email: "candidate@example.test" }, "candidate.create", { name: "Fixture Candidate", email: "candidate@example.test" }],
    ["candidates.update", { candidateId: id, phoneNumber: "+61 400 000 000" }, "candidate.update", { candidateId: id, phoneNumber: "+61 400 000 000", sendNotifications: false }],
    ["applications.get", { applicationId: id }, "application.info", { applicationId: id }],
    ["applications.create", { candidateId: id, jobId: id, interviewPlanId: stage }, "application.create", { candidateId: id, jobId: id, interviewPlanId: stage }],
    ["applications.changeStage", { applicationId: id, interviewStageId: stage }, "application.changeStage", { applicationId: id, interviewStageId: stage }],
    ["applications.changeStage", { applicationId: id, interviewStageId: stage, archiveReasonId: id }, "application.changeStage", { applicationId: id, interviewStageId: stage, archiveReasonId: id }]
  ]) {
    state.response = { success: true, results: { id, ...body } };
    assert.deepEqual(await invoke(operation, input), state.response);
    const request = requests.at(-1);
    assert.equal(request.url.pathname, `/${endpoint}`);
    assert.equal(request.init.method, "POST");
    assert.deepEqual(JSON.parse(request.init.body), body);
    assert.equal(new Headers(request.init.headers).get("authorization"), `Basic ${Buffer.from("ashby-fixture-key:").toString("base64")}`);
    assert.equal(new Headers(request.init.headers).get("accept"), "application/json; version=1");
    assert.equal(request.init.redirect, "error");
  }
  state.response = { success: true, results: [{ id: stage, type: "Interview", title: "Screen" }] };
  assert.equal((await invoke("interviewStages.list", { interviewPlanId: id })).results[0].id, stage);
  state.response = { success: true, results: [{ id: stage, text: "Position closed" }] };
  await invoke("archiveReasons.list", {});
  assert.equal(requests.at(-1).url.pathname, "/archiveReason.list");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { includeArchived: false });
  const beforeInvalid = requests.length;
  for (const [operation, input] of [
    ["candidates.create", { name: "" }], ["candidates.update", { candidateId: id }],
    ["applications.create", { candidateId: id, jobId: "wrong" }],
    ["applications.changeStage", { applicationId: id }],
    ["applications.changeStage", { applicationId: id, interviewStageId: stage, archiveEmail: {} }],
    ["applications.list", { limit: 101 }], ["interviewStages.list", {}]
  ]) await assert.rejects(invoke(operation, input));
  state.deny = true;
  await assert.rejects(invoke("applications.changeStage", { applicationId: id, interviewStageId: stage }));
  state.deny = false;
  await assert.rejects(service.invoke({ ...identity, context: { ...identity.context, applicationId: "other" }, operation: "jobs.list" }));
  assert.equal(requests.length, beforeInvalid);
  for (const response of [{ success: false, errors: [{ message: "ashby-fixture-key" }] }, { success: true, results: {} }]) {
    state.response = response;
    await assert.rejects(invoke("candidates.get", { id }), e => !JSON.stringify(e).includes("ashby-fixture-key"));
  }
  state.response = { success: true, results: [], moreDataAvailable: true };
  await assert.rejects(invoke("candidates.list", {}), { code: "connector_response_invalid" });
  for (const status of [403, 429]) {
    state.status = status;
    await assert.rejects(invoke("applications.list", {}));
  }
  state.status = 200; state.fail = true;
  const beforeUncertain = requests.length;
  await assert.rejects(invoke("candidates.create", { name: "Fixture Candidate" }));
  assert.equal(requests.length, beforeUncertain + 1);
});
