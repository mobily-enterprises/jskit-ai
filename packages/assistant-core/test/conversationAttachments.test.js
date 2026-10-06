import assert from "node:assert/strict";
import test from "node:test";
import { createConversationRuntime, createMemoryConversationStorage } from "../src/server/conversation/index.js";
import { codexLocalImageInput, codexTurnInput } from "../src/server/conversation/codexProvider.js";
import { createConversationAttachmentReader } from "../src/server/conversation/attachments.js";
import { conversationAttachmentManifest, prepareConversationAttachmentMessage } from "../src/shared/conversation/attachments.js";

const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN7sAAAAASUVORK5CYII=", "base64");
const receipt = { attachmentId: "picture", fileName: "picture.png", size: image.length };
const input = { messageId: "first", text: "Describe this", attachmentIds: [receipt.attachmentId] };
const context = { subject: "owner" };
const configuration = { integrationId: "model", systemPrompt: "Be concise." };
const resolution = () => ({ attachments: [{ ...receipt, privatePath: "/private/upload" }], content: [{ type: "image", image, mediaType: "image/png" }] });

const localFiles = [
  { attachmentId: "picture", fileName: "a b.png", size: 10 * 1024 * 1024, reference: "[Image #1]",
    contentType: "image/png", path: "/session/artifacts/a b.png" },
  { attachmentId: "data", fileName: "data.csv", size: 12, reference: "[File #1]",
    contentType: "application/octet-stream", path: "/session/artifacts/data.csv" }
];
const localReceipts = localFiles.map(({ attachmentId, fileName, size, reference }) => ({ attachmentId, fileName, size, reference }));
const localResolution = () => ({ attachments: structuredClone(localReceipts), localFiles: structuredClone(localFiles) });

function localReader({ resolve = localResolution, types = ["text", "image", "localFile"], authorize = async () => {}, maximumBytes = 1024 } = {}) {
  return createConversationAttachmentReader({ attachments: { resolve }, context, conversationId: "one",
    signal: new AbortController().signal, authorize, types, maximumBytes });
}

test("prepared local files keep the original manifest, authored message and visible receipts", () => {
  const prepared = prepareConversationAttachmentMessage({ message: "Inspect [Image #1] and [File #1]",
    displayMessage: "My authored request", messageId: "prepared" }, localFiles, localReceipts);
  assert.equal(prepared.message, 'Inspect [Image #1] and [File #1]\n\nAttached files:\n[Image #1] "a b.png": "/session/artifacts/a b.png"\n[File #1] "data.csv": "/session/artifacts/data.csv"');
  assert.equal(prepared.displayMessage, "My authored request");
  assert.equal(prepared.messageId, "prepared");
  assert.equal(prepared.attachments, localFiles);
  assert.equal(prepared.displayAttachments, localReceipts);
  assert.equal(prepareConversationAttachmentMessage({ prompt: "Fallback" }, localFiles, localReceipts).displayMessage, "Fallback");
  assert.equal(prepareConversationAttachmentMessage({ message: "", displayMessage: "" }, localFiles, localReceipts).displayMessage, "");
  assert.deepEqual(prepareConversationAttachmentMessage({ prompt: "Unchanged" }, [], []), {
    prompt: "Unchanged", attachments: [], displayAttachments: []
  });
  assert.equal(conversationAttachmentManifest([{ reference: "[File #1]", fileName: 'a"b\n.csv', path: '/session/a"b\n.csv' }]),
    '\n\nAttached files:\n[File #1] "a\\"b\\n.csv": "/session/a\\"b\\n.csv"');
});

test("authorized local files retain native paths only in transient dispatch input", async () => {
  const calls = [];
  const read = localReader({ resolve: async request => { calls.push(request); return localResolution(); } });
  const files = await read(localReceipts);
  assert.deepEqual(calls[0].attachmentIds, ["picture", "data"]);
  assert.equal(calls[0].context, context);
  assert.equal(calls[0].conversationId, "one");
  assert.deepEqual(files.attachments, localReceipts);
  assert.deepEqual(files.localFiles, localFiles);
  assert.deepEqual(files.content, []);
  assert.equal(files.attachmentManifest, '\n\nAttached files:\n[Image #1] "a b.png": "/session/artifacts/a b.png"\n[File #1] "data.csv": "/session/artifacts/data.csv"');
  assert.doesNotMatch(JSON.stringify(files.attachments), /session\/artifacts|contentType|path/);
  assert.equal(files.localFiles[0].size, 10 * 1024 * 1024, "Native files keep the host upload limit rather than the byte-image memory limit");
  assert.deepEqual(await read([]), { attachments: [], content: [], localFiles: [], attachmentManifest: "" });
});

test("local file resolution requires the exact requested receipts and native path", async () => {
  for (const change of [
    result => { result.localFiles.reverse(); },
    result => { result.localFiles[0].attachmentId = "foreign"; },
    result => { result.localFiles[0].fileName = "foreign.png"; },
    result => { result.localFiles[0].size++; },
    result => { result.localFiles[0].reference = "[Image #2]"; },
    result => { result.localFiles[0].path = "../foreign.png"; },
    result => { result.localFiles[0].path = "https://untrusted.invalid/image.png"; },
    result => { result.localFiles[0].path += "\0"; },
    result => { result.localFiles[0].contentType = "invalid"; },
    result => { result.localFiles.pop(); },
    result => { result.content = [{ type: "image", image, mediaType: "image/png" }]; }
  ]) {
    const result = localResolution();
    change(result);
    await assert.rejects(localReader({ resolve: async () => result })(localReceipts), { code: "conversation_invalid_attachments" });
  }
  await assert.rejects(localReader({ types: ["text", "image"] })(localReceipts), /cannot accept local attachment files/);
  await assert.rejects(localReader({ maximumBytes: 1 })(localReceipts), /byte limit/);
});

test("local file authorization is checked again after resolution", async () => {
  let allowed = true;
  const read = localReader({
    authorize: async () => { if (!allowed) throw new Error("Attachment access denied"); },
    resolve: async () => { allowed = false; return localResolution(); }
  });
  await assert.rejects(read(localReceipts), /Attachment access denied/);
});

test("API rejects resolver-only native files before admission or dispatch", async t => {
  const f = await fixture(t, { resolve: localResolution });
  await assert.rejects(f.conversation.send({ messageId: "native-only", text: "Inspect", attachmentIds: ["picture", "data"] }),
    /cannot accept local attachment files/);
  assert.equal(f.requests.length, 0);
  assert.equal((await f.conversation.read()).conversationLog.length, 0);
});

test("Codex translates resolved images into native input and leaves other files as path references", () => {
  const attachments = [
    { attachmentId: "image", fileName: "a b.png", path: "/session/artifacts/a b.png", contentType: "image/png" },
    { attachmentId: "file", fileName: "data.csv", path: "/session/artifacts/data.csv", contentType: "application/octet-stream" }
  ];
  const codexInput = codexTurnInput([
    "Inspect [Image #1] and [File #1]",
    ...codexLocalImageInput(attachments)
  ]);
  assert.deepEqual(codexInput, [
    { type: "text", text: "Inspect [Image #1] and [File #1]", text_elements: [] },
    { type: "localImage", path: attachments[0].path }
  ]);
});

async function fixture(t, { storage = createMemoryConversationStorage(), resolve = resolution, limits, authorize = () => true } = {}) {
  const requests = [];
  const reads = [];
  const runtime = createConversationRuntime({ storage, authorize, limits,
    connections: { resolve: async () => ({ providerId: "test", model: "test", sdkPackage: "@ai-sdk/openai-compatible",
      apiKey: "test", baseURL: "https://provider.invalid/v1" }) },
    attachments: { resolve: async request => { reads.push(request); return resolve(request); } },
    fetch: async (url, request) => {
      requests.push(JSON.parse(request.body));
      return new Response('data: {"choices":[{"delta":{"content":"A picture."}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        { headers: { "content-type": "text/event-stream" } });
    }
  });
  t.after(() => runtime.close());
  const conversation = await runtime.open({ id: "one", context, configuration });
  return { runtime, conversation, storage, requests, reads };
}

test("authorized image bytes reach the API once and only safe receipts enter stored messages", async t => {
  const f = await fixture(t);
  assert.equal(f.conversation.capabilities.attachments, true);
  const [first, duplicate] = await Promise.all([f.conversation.send(input), f.conversation.send(input)]);
  assert.equal(first.turnId, duplicate.turnId);
  const state = await f.conversation.wait();
  assert.equal(state.conversationLog[0].metadata.runtime.status, "complete", state.error);
  assert.equal(f.requests.length, 1);
  assert.equal(f.reads.length, 1);
  assert.equal(f.reads[0].context, context);
  assert.equal(f.reads[0].conversationId, "one");
  assert.deepEqual(f.reads[0].attachmentIds, [receipt.attachmentId]);
  assert.deepEqual(f.requests[0].messages.at(-1).content, [
    { type: "text", text: input.text }, { type: "image_url", image_url: { url: `data:image/png;base64,${image.toString("base64")}` } }
  ]);
  assert.deepEqual(state.conversationLog[0].user.attachments, [receipt]);
  assert.doesNotMatch(JSON.stringify(state), /privatePath|private\/upload|iVBOR/);
  assert.equal((await f.conversation.send(input)).duplicate, true);
  assert.equal(f.reads.length, 1, "An accepted retry returns its receipt without rereading files or resending");
  await assert.rejects(f.conversation.send({ ...input, attachmentIds: ["different"] }), { code: "conversation_message_conflict" });
});

test("API history and continuity reauthorize files after reopen and renewal", async t => {
  let allowed = true;
  const resolve = () => {
    if (!allowed) throw new Error("This identity no longer has attachment access");
    return resolution();
  };
  const f = await fixture(t, { resolve });
  await f.conversation.send(input);
  const first = await f.conversation.wait();
  await f.runtime.close();
  const resumed = await fixture(t, { storage: f.storage, resolve });
  await resumed.conversation.send({ messageId: "second", text: "What was in it?" });
  await resumed.conversation.wait();
  assert.equal(resumed.requests[0].messages[1].content[1].type, "image_url");
  await resumed.conversation.replace({ operationId: "renew", reason: "renewal", expectedSegmentId: first.segmentId });
  await resumed.conversation.send({ messageId: "third", text: "Look again" });
  await resumed.conversation.wait();
  assert.equal(resumed.requests[1].messages.at(-1).content[1].type, "image_url");
  allowed = false;
  await assert.rejects(resumed.conversation.send({ messageId: "denied", text: "Look again" }), /attachment access/);
  assert.equal(resumed.requests.length, 2);
  assert.equal((await resumed.conversation.read()).conversationLog.length, 3);
});

test("an image-only request is accepted without invented user text", async t => {
  const f = await fixture(t);
  await f.conversation.send({ ...input, text: "" });
  const state = await f.conversation.wait();
  assert.equal(f.requests[0].messages.at(-1).content.length, 1);
  assert.equal(f.requests[0].messages.at(-1).content[0].type, "image_url");
  assert.equal(state.conversationLog[0].user.text, "");
});

test("denied files and malformed resolver content never admit a message or dispatch a model request", async t => {
  const cases = [
    () => { throw new Error("Attachment access denied"); },
    () => ({ ...resolution(), attachments: [{ ...receipt, attachmentId: "someone-elses-file" }] }),
    () => ({ ...resolution(), content: [] }),
    () => ({ ...resolution(), content: [{ type: "image", image: "https://untrusted.invalid/image.png", mediaType: "image/png" }] }),
    () => ({ ...resolution(), content: [{ type: "image", image, mediaType: "image/unknown" }] }),
    () => ({ ...resolution(), content: [{ type: "file", data: "/private/upload", mediaType: "application/pdf" }] })
  ];
  for (const resolve of cases) {
    const f = await fixture(t, { resolve });
    await assert.rejects(f.conversation.send(input));
    assert.equal(f.requests.length, 0);
    const state = await f.conversation.read();
    assert.equal(state.pendingRequest, null);
    assert.equal(state.conversationLog.length, 0);
  }
});

test("invalid IDs and caller-supplied attachment content do not reach the resolver", async t => {
  const f = await fixture(t);
  for (const attachmentIds of [null, "picture", [""], ["picture", "picture"], [{}], Array.from({ length: 11 }, (_, i) => String(i))]) {
    await assert.rejects(f.conversation.send({ ...input, attachmentIds }), { code: "conversation_invalid_attachments" });
  }
  await assert.rejects(f.conversation.send({ ...input, attachments: [resolution()] }), { code: "conversation_unsupported" });
  assert.equal(f.reads.length, 0);
  assert.equal(f.requests.length, 0);
});

test("attachment bytes are bounded across current input and restored history", async t => {
  const f = await fixture(t, { limits: { maxAttachmentBytes: image.length } });
  await f.conversation.send(input);
  await f.conversation.wait();
  await assert.rejects(f.conversation.send({ ...input, messageId: "second" }), /byte limit/);
  assert.equal(f.requests.length, 1);
  const text = await fixture(t, { limits: { maxAttachmentBytes: 3 }, resolve: () => ({
    attachments: [receipt], content: [{ type: "text", text: "Too long" }]
  }) });
  await assert.rejects(text.conversation.send(input), /byte limit/);
  assert.equal(text.requests.length, 0);
});

test("authorization revoked during file resolution prevents dispatch", async t => {
  let allowed = true;
  const f = await fixture(t, { authorize: () => allowed, resolve: () => { allowed = false; return resolution(); } });
  await assert.rejects(f.conversation.send(input), { code: "conversation_forbidden" });
  assert.equal(f.requests.length, 0);
  allowed = true;
  assert.equal((await f.conversation.read()).conversationLog.length, 0);
});
