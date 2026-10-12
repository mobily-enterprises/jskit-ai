import path from "node:path";
import { chmod, copyFile, lstat, mkdtemp, open, realpath, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

// Providers retain their grammar; stopped file custody belongs to this owner.
// Immutable reads require no journal. A valid stopped WAL is read from private
// copies so SQLite can build its own SHM without touching native storage.
export async function readStoppedNativeDatabase(databasePath, read, { signal } = {}) {
  if (!path.isAbsolute(databasePath || "") || typeof read !== "function") {
    throw new TypeError("Native inspection requires an absolute database path and reader.");
  }
  const journalError = () => new Error("Native storage still has a journal sidecar that cannot be inspected safely. Keep its original storage owner stopped; inspection does not checkpoint or remove it.");
  const inspect = async () => {
    const files = {};
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      signal?.throwIfAborted();
      const file = `${databasePath}${suffix}`;
      let info;
      try { info = await lstat(file); }
      catch (error) { if (suffix && error.code === "ENOENT") continue; throw error; }
      if (!info.isFile() || info.isSymbolicLink() || await realpath(file) !== file) {
        throw new Error("Native storage must be a regular file at its original canonical path.");
      }
      files[suffix] = info;
    }
    if (files["-journal"] || Boolean(files["-wal"]) !== Boolean(files["-shm"])) throw journalError();
    return files;
  };
  const before = await inspect();
  const fingerprint = async file => {
    const hash = createHash("sha256");
    try {
      for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
      return hash.digest("hex");
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      throw error;
    }
  };
  const unchanged = async (digests = null) => {
    const after = await inspect();
    if (JSON.stringify(Object.keys(before)) !== JSON.stringify(Object.keys(after)) ||
        Object.keys(before).some(suffix => ["dev", "ino", "size", "mtimeMs", "ctimeMs", "mode"].some(key => before[suffix][key] !== after[suffix][key]))) {
      throw new Error("Native storage changed during inspection. Keep all of its writers stopped before retrying.");
    }
    if (digests) for (const suffix of Object.keys(before)) {
      if (await fingerprint(`${databasePath}${suffix}`) !== digests[suffix]) {
        throw new Error("Native storage changed during inspection. Keep all of its writers stopped before retrying.");
      }
    }
  };
  const { DatabaseSync } = await import("node:sqlite");
  let directory;
  let database;
  let result;
  let digests;
  try {
    signal?.throwIfAborted();
    let target = `${pathToFileURL(databasePath).href}?mode=ro&immutable=1`;
    if (before["-wal"]) {
      // Eligibility only: SQLite owns WAL frames, checksums and committed pages.
      const header = Buffer.alloc(32);
      const wal = await open(`${databasePath}-wal`, "r");
      let bytesRead;
      try { ({ bytesRead } = await wal.read(header, 0, header.length, 0)); }
      finally { await wal.close(); }
      const magic = header.readUInt32BE(0);
      const pageSize = header.readUInt32BE(8);
      if (bytesRead !== 32 || ![0x377f0682, 0x377f0683].includes(magic) || header.readUInt32BE(4) !== 3007000 ||
          pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0 || before["-shm"].size < 32768) throw journalError();
      digests = {};
      for (const suffix of Object.keys(before)) digests[suffix] = await fingerprint(`${databasePath}${suffix}`);
      await unchanged(digests);
      directory = await mkdtemp(path.join(tmpdir(), "assistant-native-snapshot-"));
      const snapshot = path.join(directory, "native.db");
      for (const suffix of ["", "-wal"]) {
        signal?.throwIfAborted();
        await copyFile(`${databasePath}${suffix}`, `${snapshot}${suffix}`);
        await chmod(`${snapshot}${suffix}`, 0o600);
        if (await fingerprint(`${snapshot}${suffix}`) !== digests[suffix]) throw new Error("Native storage changed while copying its stopped snapshot.");
      }
      await unchanged(digests);
      target = `${pathToFileURL(snapshot).href}?mode=ro`;
    }
    database = new DatabaseSync(target, { readOnly: true });
    database.exec("PRAGMA query_only=ON; BEGIN");
    result = await read(database);
    signal?.throwIfAborted();
    database.exec("ROLLBACK");
    await unchanged(digests);
  } finally {
    try { database?.close(); }
    finally { if (directory) await rm(directory, { recursive: true, force: true }); }
  }
  return result;
}

export function canonicalNativeHistoryJson(value) {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]])) : entry);
}

// Providers own record projection; this small sink owns the common byte bound,
// callback backpressure and exact content revision used before retirement.
export function createNativeHistoryExport(onRecord, { signal, maxBytes = 2 * 1024 ** 3 } = {}) {
  if (typeof onRecord !== "function") throw new TypeError("Native export requires a record callback.");
  const digest = createHash("sha256");
  let bytes = 0;
  let recordCount = 0;
  return {
    async emit(record) {
      signal?.throwIfAborted();
      const serialized = `${canonicalNativeHistoryJson(record)}\n`;
      bytes += Buffer.byteLength(serialized);
      if (bytes > maxBytes) throw new Error("Native export exceeded its byte limit; history was not retired.");
      digest.update(serialized);
      recordCount++;
      // An admitted host callback may still publish under the archive lock.
      // Cancellation must await its completion; the host owns cancelling its IO.
      await onRecord(record);
      signal?.throwIfAborted();
    },
    complete(extra = {}) {
      signal?.throwIfAborted();
      return { revision: digest.digest("hex"), bytes, recordCount, ...extra };
    }
  };
}

// Shared by the three native owners. The host must durably preserve customer
// history, check references across projects and exclude external CLI writers.
// This callback is trusted server code, never request data or a retention rule.
export async function retireNativeConversation({ binding, inspect, remove, beforeDelete, readConversation, exportConversation }) {
  if (typeof beforeDelete !== "function") throw new TypeError("Native retirement requires a host preservation callback.");
  if (!binding?.conversationId || !path.isAbsolute(binding.workdir || "")) {
    throw new TypeError("Native retirement requires an exact conversation and absolute native directory.");
  }
  const before = await inspect();
  if (before.length === 0) return { ok: true, alreadyAbsent: true, conversationIds: [] };
  const snapshot = JSON.stringify(before);
  const ids = new Set(before.map((entry) => entry.conversationId));
  const inventory = {
    binding: structuredClone(binding),
    conversations: structuredClone(before)
  };
  if (readConversation) {
    inventory.readConversation = (id) => {
      if (!ids.has(id)) throw new Error("Cannot export a conversation outside the inspected native family.");
      return readConversation(id);
    };
  }
  const exported = new Map();
  let preserving = true;
  if (exportConversation) {
    inventory.exportConversation = async (id, onRecord) => {
      if (!preserving || !ids.has(id)) throw new Error("Cannot export a conversation outside the inspected preservation scope.");
      const result = await exportConversation(id, onRecord);
      if (!/^[a-f0-9]{64}$/u.test(result?.revision || "")) throw new Error("Native export did not confirm a complete history revision.");
      exported.set(id, result.revision);
      return result;
    };
  }
  let proof;
  try { proof = await beforeDelete(inventory); }
  finally { preserving = false; }
  if (proof?.preserved !== true || proof?.exclusive !== true) {
    throw new Error("The host did not confirm preserved history and exclusive ownership of every native conversation.");
  }
  if (exportConversation) {
    if (exported.size !== ids.size) throw new Error("Preserve the complete native export of every inspected conversation before retirement.");
    for (const id of ids) {
      if ((await exportConversation(id, async () => {})).revision !== exported.get(id)) {
        throw new Error("Native history changed during preservation. Export and preserve it again before retirement.");
      }
    }
  }
  if (JSON.stringify(await inspect()) !== snapshot) {
    throw new Error("Native history changed during preservation. Inspect and preserve it again before retirement.");
  }
  await remove(before);
  if ((await inspect()).length !== 0) throw new Error("Native deletion was not confirmed; retain the cleanup receipt and retry.");
  return { ok: true, alreadyAbsent: false, conversationIds: before.map((entry) => entry.conversationId) };
}

