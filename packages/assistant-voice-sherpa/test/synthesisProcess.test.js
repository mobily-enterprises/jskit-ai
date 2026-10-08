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


test("a request abort during model loading waits for child exit instead of the load timeout", { timeout: 5_000 }, async t => {
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "speech-process-load-abort-"));
  const pidFile = join(root, "loading.pid");
  const controller = new AbortController();
  let pid;
  t.after(async () => {
    controller.abort();
    if (pid) {
      try { process.kill(pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    await rm(root, { recursive: true, force: true });
  });
  const loading = assert.rejects(createSynthesisProcess({ holdLoadPidFile: pidFile }, {
    workerUrl, signal: controller.signal
  }), { name: "AbortError" });
  for (let tries = 0; tries < 200; tries += 1) {
    try { pid = Number(await readFile(pidFile, "utf8")); break; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(Number.isSafeInteger(pid) && pid > 0, "a real child is held before metadata is returned");
  controller.abort();
  await loading;
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "cancellation settles only after native child exit");
});

test("an already aborted model load creates no child-side load effect", async t => {
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "speech-process-pre-abort-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pidFile = join(root, "loading.pid");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createSynthesisProcess({ holdLoadPidFile: pidFile }, {
    workerUrl, signal: controller.signal
  }), { name: "AbortError" });
  await assert.rejects(readFile(pidFile), { code: "ENOENT" });
});

test("a completed load's signal cannot cancel the warm worker used by an independent request", async t => {
  const formerOwner = new AbortController();
  const worker = await createSynthesisProcess({}, { workerUrl, signal: formerOwner.signal });
  t.after(() => worker.close());
  const frames = [];
  const result = await worker.synthesize("The next owner.", {
    onAudio(frame) { frames.push(frame); formerOwner.abort(); }
  });
  assert.deepEqual(result, { cancelled: false, sampleRate: 22050, samples: 2 });
  assert.deepEqual(frames, [Buffer.from([1, 0, 2, 0])]);
  assert.equal(worker.running, true, "the detached load signal cannot kill a later owner's native work");
  assert.equal((await worker.synthesize("Keep reusing the warm worker.")).cancelled, false);
});
