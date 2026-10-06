import assert from "node:assert/strict";
import { Readable, Duplex, PassThrough } from "node:stream";
import { test } from "node:test";
import { createClaudeJsonClient, readClaudeJsonFrames } from "../src/server/conversation/claudeClient.js";

async function frames(chunks, options) {
  const result = [];
  for await (const frame of readClaudeJsonFrames(Readable.from(chunks), options)) result.push(frame);
  return result;
}

test("Claude JSON frames survive every byte boundary, including Unicode and escaped newlines", async () => {
  const expected = [{ type: "assistant", text: "Hello 🌏\n世界" }, { type: "result", is_error: false }];
  const bytes = Buffer.from(`${expected.map((frame) => JSON.stringify(frame)).join("\r\n")}\n`);
  assert.deepEqual(await frames([...bytes].map((byte) => Buffer.from([byte]))), expected);
  assert.deepEqual(await frames([bytes]), expected);
});

test("Claude JSON framing bounds fragmented and complete frames and rejects malformed data without echoing it", async () => {
  await assert.rejects(frames([Buffer.from('{"type":"secret"}\n')], { maxFrameBytes: 8 }), /size limit/u);
  await assert.rejects(frames([Buffer.alloc(4, 32), Buffer.alloc(5, 32)], { maxFrameBytes: 8 }), /size limit/u);
  await assert.rejects(frames([Buffer.from("secret token\n")]), (error) => !error.message.includes("secret token"));
  await assert.rejects(frames([Buffer.from('{"type":"user","text":"'), Buffer.from([255]), Buffer.from('"}\n')]), /invalid UTF-8/u);
  await assert.rejects(frames([Buffer.from('[]\n')]), /event type/u);
  await assert.rejects(frames([Buffer.from('{"type":"result"}')]), /incomplete/u);
  assert.deepEqual(await frames([Buffer.from('{"type":"result"}')], { allowIncompleteTail: true }), []);
});

function fakeStream(onWrite) {
  return new Duplex({ read() {}, write(chunk, _encoding, callback) {
    Promise.resolve().then(() => onWrite(JSON.parse(String(chunk)), this)).then(() => callback(), callback);
  } });
}

test("Claude controls correlate out-of-order replies and events apply backpressure", async () => {
  const requests = [];
  const observed = [];
  const stream = fakeStream((frame, socket) => {
    requests.push(frame);
    if (requests.length === 2) for (const request of [...requests].reverse()) {
      socket.push(`${JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: request.request_id, response: { name: request.request.subtype } } })}\n`);
    }
  });
  const client = createClaudeJsonClient({ stream, onEvent: async (frame) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    observed.push(frame.number);
  } });
  assert.deepEqual(await Promise.all([client.request({ subtype: "one" }), client.request({ subtype: "two" })]), [{ name: "one" }, { name: "two" }]);
  stream.push('{"type":"test","number":1}\n{"type":"test","number":2}\n');
  stream.push(null);
  await client.completion;
  assert.deepEqual(observed, [1, 2]);
  client.close();
});

test("Claude control replies bypass slow event persistence while events remain ordered", async () => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const observed = [];
  const stream = fakeStream((frame, socket) => socket.push(`${JSON.stringify({
    type: "control_response", response: { subtype: "success", request_id: frame.request_id, response: {} }
  })}\n`));
  const client = createClaudeJsonClient({ stream, onEvent: async (frame) => {
    if (frame.number === 1) { entered.resolve(); await release.promise; }
    observed.push(frame.number);
  } });
  stream.push('{"type":"event","number":1}\n{"type":"event","number":2}\n');
  await entered.promise;
  try {
    await client.request({ subtype: "interrupt" }, { timeoutMs: 100 });
    assert.deepEqual(observed, []);
    release.resolve();
    stream.push(null);
    await client.completion;
    assert.deepEqual(observed, [1, 2]);
  } finally {
    release.resolve();
    client.close();
  }
});

test("Claude interrupt uses the common 30-second control deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = createClaudeJsonClient({ stream: fakeStream(() => {}) });
  const pending = client.interrupt();
  let settled = false;
  const rejected = assert.rejects(pending, /interrupt timed out/u).then(() => { settled = true; });
  t.mock.timers.tick(29_999);
  await Promise.resolve();
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  await rejected;
  client.close();
  await client.completion;
});

test("Claude control timeouts and pipe closure reject pending work promptly", async () => {
  const stream = fakeStream(() => {});
  const client = createClaudeJsonClient({ stream, timeoutMs: 10 });
  await assert.rejects(client.initialize(), /timed out/u);
  const pending = client.request({ subtype: "interrupt" }, { timeoutMs: 10_000 });
  stream.push(null);
  await assert.rejects(pending, /ended unexpectedly/u);
  await client.completion;
});

test("native startup ending before initialization reports failure without an unhandled stream error", async t => {
  const writable = new PassThrough();
  t.after(() => writable.destroy());
  const stream = Duplex.from({ readable: Readable.from([]), writable });
  const observed = [];
  const client = createClaudeJsonClient({ stream, onFailure: error => observed.push(error) });
  await assert.rejects(client.initialize(), /ended unexpectedly/u);
  await client.completion;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stream.destroyed, true);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].code, "assistant_claude_observation_lost");
});

test("incoming tools wait for admission while outgoing interrupts remain responsive", async () => {
  const admitted = Promise.withResolvers();
  const invoked = Promise.withResolvers();
  const finishTool = Promise.withResolvers();
  const written = [];
  const stream = fakeStream((frame, socket) => {
    written.push(frame);
    if (frame.type === "control_request") socket.push(`${JSON.stringify({ type: "control_response",
      response: { subtype: "success", request_id: frame.request_id, response: {} } })}\n`);
  });
  const client = createClaudeJsonClient({ stream, onEvent: () => admitted.promise,
    onControlRequest: async request => { invoked.resolve(request); return finishTool.promise; } });
  stream.push('{"type":"user"}\n{"type":"control_request","request_id":"tool","request":{"subtype":"mcp_message"}}\n');
  await client.interrupt();
  assert.equal(written.filter(frame => frame.type === "control_response").length, 0);
  admitted.resolve();
  assert.equal((await invoked.promise).subtype, "mcp_message");
  await client.interrupt();
  finishTool.resolve({ mcp_response: { result: { content: [] } } });
  await client.whenRequestsIdle();
  assert.equal(written.find(frame => frame.response?.request_id === "tool").response.subtype, "success");
  client.close();
  await client.completion;
});

test("closing the native connection cancels incoming requests but drains invoked application work", async () => {
  const invoked = Promise.withResolvers();
  const finishTool = Promise.withResolvers();
  const written = [];
  const stream = fakeStream(frame => written.push(frame));
  const client = createClaudeJsonClient({ stream, onControlRequest: async (_request, { signal }) => {
    invoked.resolve(signal);
    return finishTool.promise;
  } });
  stream.push('{"type":"control_request","request_id":"tool","request":{"subtype":"mcp_message"}}\n');
  const signal = await invoked.promise;
  client.close();
  assert.equal(signal.aborted, true);
  let drained = false;
  const drain = client.whenRequestsIdle().then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(drained, false);
  finishTool.resolve({});
  await drain;
  await client.completion;
  assert.equal(written.length, 0, "A cancelled control has no late response");
});

test("unregistered headless controls are denied and repeated active control IDs fail closed", async () => {
  const response = Promise.withResolvers();
  const stream = fakeStream(frame => response.resolve(frame));
  const client = createClaudeJsonClient({ stream });
  stream.push('{"type":"control_request","request_id":"permission","request":{"subtype":"can_use_tool"}}\n');
  assert.equal((await response.promise).response.subtype, "error");
  client.close();
  await client.completion;

  const failure = Promise.withResolvers();
  const other = fakeStream(() => {});
  const second = createClaudeJsonClient({ stream: other, onControlRequest: (_request, { signal }) => new Promise(resolve => {
    signal.addEventListener("abort", resolve, { once: true });
  }), onFailure: failure.resolve });
  const duplicate = '{"type":"control_request","request_id":"same","request":{"subtype":"mcp_message"}}\n';
  other.push(duplicate + duplicate);
  assert.match((await failure.promise).message, /reused an active request/);
  await second.whenRequestsIdle();
  second.close();
  await second.completion;
});
