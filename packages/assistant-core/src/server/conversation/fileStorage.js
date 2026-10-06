import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createConversationStorage } from "./storage.js";

/** Persistent single-process storage. The application supplies a private directory
 * and shares one instance; multiple writers need a transactional application store.
 */
export function createFileConversationStorage({ directory } = {}) {
  if (typeof directory !== "string" || !directory.trim()) {
    throw new TypeError("File conversation storage requires a directory.");
  }
  const root = resolve(directory);
  const filename = (id) => join(root, `${createHash("sha256").update(id).digest("hex")}.json`);

  async function readRecord(id) {
    let source;
    try { source = await readFile(filename(id), "utf8"); }
    catch (error) { if (error.code === "ENOENT") return { turns: new Map(), metadata: {} }; throw error; }
    let document;
    try { document = JSON.parse(source); }
    catch { throw new Error("Conversation storage contains invalid JSON. Restore it from a backup before writing."); }
    if (document?.version !== 1 || document.scope !== id || !Array.isArray(document.turns) ||
        (document.metadata != null && (typeof document.metadata !== "object" || Array.isArray(document.metadata))) ||
        document.turns.some((entry) => !Array.isArray(entry) || entry.length !== 2 ||
          typeof entry[0] !== "string" || !entry[0] || !Array.isArray(entry[1]?.messages) ||
          entry[1].messages.some((message) => !message || typeof message.role !== "string" ||
            typeof message.text !== "string" || typeof message.at !== "string")) ||
        new Set(document.turns.map(([turnId]) => turnId)).size !== document.turns.length) {
      throw new Error("Conversation storage has an unsupported or damaged format. Restore it from a backup before writing.");
    }
    return { turns: new Map(document.turns), metadata: document.metadata || {} };
  }

  return createConversationStorage({
    readRecord,
    async writeRecord(id, { turns, metadata }) {
      // Serialize before touching the filesystem: failed transactions cannot
      // replace the last saved conversation or leave a partial document.
      const body = JSON.stringify({ version: 1, scope: id, metadata, turns: [...turns] });
      await mkdir(root, { recursive: true, mode: 0o700 });
      const path = filename(id);
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, body, { flag: "wx", mode: 0o600, flush: true });
        await rename(temporary, path);
      } finally {
        await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
      }
    },
    async deleteRecord(id) {
      await unlink(filename(id)).catch((error) => { if (error.code !== "ENOENT") throw error; });
    }
  });
}
