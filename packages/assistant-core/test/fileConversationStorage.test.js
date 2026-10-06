import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { createFileConversationStorage } from "../src/server/conversation/fileStorage.js";
import { createConversationTranscript } from "../src/server/conversation/transcript.js";
import { verifyConversationStorageContract } from "../src/testing/conversationStorageContract.js";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "jskit-conversations-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storage = createFileConversationStorage({ directory });
  return { directory, storage, transcript: createConversationTranscript({ storage }) };
}

test("file conversations satisfy the shared storage contract and survive a new process", async (t) => {
  const f = await fixture(t);
  const { scope, transcript } = await verifyConversationStorageContract(f.storage, { runtime: true });
  const expected = await transcript.readConversationLog(scope);
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `
    import { createFileConversationStorage } from ${JSON.stringify(new URL("../src/server/conversation/fileStorage.js", import.meta.url).href)};
    import { createConversationTranscript } from ${JSON.stringify(new URL("../src/server/conversation/transcript.js", import.meta.url).href)};
    const storage = createFileConversationStorage({ directory: process.argv[1] });
    const transcript = createConversationTranscript({ storage });
    process.stdout.write(JSON.stringify(await transcript.readConversationLog(process.argv[2])));
  `, f.directory, scope]);
  assert.deepEqual(JSON.parse(stdout), expected);
  assert.equal((await readdir(f.directory)).some((name) => name.endsWith(".tmp")), false);
  if (process.platform !== "win32") {
    const files = await readdir(f.directory);
    assert.equal((await stat(join(f.directory, files[0]))).mode & 0o777, 0o600);
  }
});

test("a failed file transaction preserves saved bytes and permits the next write", async (t) => {
  const f = await fixture(t);
  await f.transcript.writeConversationUserMessage("one", { messageId: "one", text: "Saved" });
  const [filename] = await readdir(f.directory);
  const before = await readFile(join(f.directory, filename));
  await assert.rejects(f.storage.write("one", async (transaction) => {
    await transaction.appendMessage("000002", { role: "user", text: "Uncommitted", at: "2026-01-01" });
    throw new Error("transaction failed");
  }), /transaction failed/);
  assert.deepEqual(await readFile(join(f.directory, filename)), before);
  await f.transcript.writeConversationAssistantMessage("one", { text: "Answer" });
  assert.equal((await f.transcript.readConversationLog("one"))[0].assistant.text, "Answer");
});

test("damaged or unsupported stored data fails explicitly and is never overwritten", async (t) => {
  const f = await fixture(t);
  await f.transcript.writeConversationUserMessage("one", { text: "Saved" });
  const [filename] = await readdir(f.directory);
  const path = join(f.directory, filename);
  for (const damaged of ["{", "null", '{"version":2}', '{"version":1,"scope":"other","turns":[]}']) {
    await writeFile(path, damaged);
    await assert.rejects(f.transcript.readConversationLog("one"), /Conversation storage/);
    await assert.rejects(f.transcript.writeConversationUserMessage("one", { text: "Do not replace" }), /Conversation storage/);
    assert.equal(await readFile(path, "utf8"), damaged);
  }
});

test("application scopes cannot traverse paths and deletion remains isolated", async (t) => {
  const f = await fixture(t);
  await f.transcript.writeConversationUserMessage("../../other", { text: "One" });
  await f.transcript.writeConversationUserMessage("other", { text: "Two" });
  assert.equal((await readdir(f.directory)).length, 2);
  await f.storage.deleteConversation("../../other");
  assert.deepEqual(await f.transcript.readConversationLog("../../other"), []);
  assert.equal((await f.transcript.readConversationLog("other"))[0].user.text, "Two");
});
