import assert from "node:assert/strict";
import test from "node:test";
import { createSynthesisProcess } from "../src/synthesisProcess.js";

const workerUrl = new URL("./fixtures/synthesisWorker.js", import.meta.url);

test("synthesis crosses the process boundary and close releases the worker", async t => {
  const worker = await createSynthesisProcess({}, { workerUrl });
  t.after(() => worker.close());
  const frames = [];
  assert.deepEqual(await worker.synthesize("Hello.", { onAudio: frame => frames.push(frame) }), {
    cancelled: false, sampleRate: 22050, samples: 2
  });
  assert.deepEqual(frames, [Buffer.from([1, 0, 2, 0])]);
  await worker.close();
  assert.equal(worker.running, false);
  assert.throws(() => process.kill(worker.pid, 0), { code: "ESRCH" });
});

test("cancelling synthesis releases native work before returning and delivers no later audio", async t => {
  const worker = await createSynthesisProcess({}, { workerUrl });
  t.after(() => worker.close());
  const controller = new AbortController();
  let frames = 0;
  const result = await worker.synthesize("wait", { signal: controller.signal, onAudio() { frames += 1; controller.abort(); } });
  assert.equal(result.cancelled, true);
  assert.equal(frames, 1);
  assert.equal(worker.running, false);
  assert.throws(() => process.kill(worker.pid, 0), { code: "ESRCH" });
});

test("unexpected worker exit and invalid model loading fail promptly without an orphan", async t => {
  await assert.rejects(createSynthesisProcess({ invalid: true }, { workerUrl }), /Invalid native model/u);
  const worker = await createSynthesisProcess({}, { workerUrl });
  t.after(() => worker.close());
  await assert.rejects(worker.synthesize("crash"), /exited \(17\)/u);
  assert.throws(() => process.kill(worker.pid, 0), { code: "ESRCH" });
});
