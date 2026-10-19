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

test("saved conversations are parsed once until they change and look messages up by identity", async (t) => {
  const f = await fixture(t);
  await f.transcript.writeConversationUserMessage("cached", { text: "First", messageId: "first", at: "2026-01-01T00:00:00Z" });
  await f.transcript.writeConversationUserMessage("cached", { text: "Second", messageId: "second", at: "2026-01-01T00:00:01Z" });
  const [file] = (await readdir(f.directory)).filter(name => name.endsWith(".json"));
  const parse = JSON.parse;
  let parsed = 0;
  JSON.parse = (...args) => { parsed += 1; return parse(...args); };
  try {
    assert.equal((await f.transcript.findSubmittedTurn("cached", "second")).user.text, "Second");
    assert.equal(await f.transcript.conversationMessageIdExists("cached", "first"), true);
    assert.equal(await f.transcript.conversationMessageIdExists("cached", "missing"), false);
    assert.equal(await f.transcript.findSubmittedTurn("cached", "missing"), null);
    assert.equal((await f.transcript.readConversationLog("cached")).length, 2);
    assert.equal(parsed, 0, "The record written by this process is reused.");
    // An external writer changes the saved file; the next read parses it.
    const saved = parse(await readFile(join(f.directory, file), "utf8"));
    saved.turns[1][1].messages[0].text = "Edited elsewhere";
    await writeFile(join(f.directory, file), JSON.stringify(saved));
    assert.equal((await f.transcript.findSubmittedTurn("cached", "second")).user.text, "Edited elsewhere");
    assert.equal(parsed, 1);
  } finally { JSON.parse = parse; }
  // Changes made inside a failed write or a read never reach the saved record.
  await assert.rejects(f.storage.write("cached", async transaction => {
    await transaction.appendMessage("000001", { role: "assistant", text: "Discarded", at: "2026-01-01T00:00:02Z" });
    throw new Error("rolled back");
  }), /rolled back/);
  await f.storage.read("cached", transaction => transaction.appendMessage("000001", { role: "assistant", text: "Read only", at: "2026-01-01T00:00:03Z" }));
  assert.equal((await f.transcript.readConversationLog("cached"))[0].assistant, null);
});
