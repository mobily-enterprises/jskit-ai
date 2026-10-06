import path from "node:path";
import { createHash } from "node:crypto";

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

