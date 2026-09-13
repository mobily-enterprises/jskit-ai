import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { ConnectorError } from "./errors.js";

function createFileConnectionStore({ directory, protection, directoryMode = 0o700, fileMode = 0o600, now = Date.now }) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) throw new TypeError("Use an absolute private runtime directory.");
  if (typeof protection?.seal !== "function" || typeof protection?.open !== "function") throw new TypeError("Credential protection is required.");
  const root = path.resolve(directory);
  const storageError = () => new ConnectorError("connector_storage_invalid", "Connection state could not be read safely.", { statusCode: 500 });

  async function withConnection({ owner, integrationId }, work) {
    await mkdir(root, { recursive: true, mode: directoryMode });
    if (!(await lstat(root)).isDirectory() || await realpath(root) !== root) throw storageError();
    const identity = [owner.applicationId, owner.subjectId, integrationId];
    if (identity.some((value) => typeof value !== "string" || !value)) throw new TypeError("Connection storage requires a complete owner and slot.");
    const key = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
    const file = path.join(root, `${key}.json`);
    const binding = `file-connection:${key}`;
    let compromised = false;
    const release = await lockfile.lock(file, {
      realpath: false, stale: 60_000, update: 10_000,
      retries: { retries: 80, minTimeout: 100, maxTimeout: 500 },
      onCompromised() { compromised = true; }
    });
    try {
      let record = { connection: null, attempts: {} };
      let handle;
      try {
        handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        const info = await handle.stat();
        if (!info.isFile() || info.size > 4 * 1024 * 1024) throw storageError();
        const envelope = JSON.parse(await handle.readFile("utf8"));
        if (envelope.schemaVersion !== 1 || typeof envelope.payload !== "string") throw storageError();
        record = await protection.open(envelope.payload, binding);
        if (!record || !Object.hasOwn(record, "connection") || !record.attempts || typeof record.attempts !== "object" || Array.isArray(record.attempts)) throw storageError();
      } catch (error) {
        if (error.code !== "ENOENT") throw storageError();
      } finally { await handle?.close(); }
      let changed = false;
      for (const [state, attempt] of Object.entries(record.attempts)) {
        if (attempt.expiresAt <= now()) { delete record.attempts[state]; changed = true; }
      }
      const attemptKey = (state) => createHash("sha256").update(state).digest("hex");
      const result = await work({
        connection: structuredClone(record.connection),
        save: async (connection) => { record.connection = structuredClone(connection); changed = true; },
        remove: async () => { record = { connection: null, attempts: {} }; changed = true; },
        putAttempt: async (attempt) => { record.attempts[attemptKey(attempt.state)] = structuredClone(attempt); changed = true; },
        latestAttempt: async ({ after }) => structuredClone(Object.values(record.attempts)
          .filter((attempt) => attempt.expiresAt > after)
          .sort((a, b) => b.expiresAt - a.expiresAt)[0] || null),
        consumeAttempt: async (state) => {
          const id = attemptKey(state);
          const attempt = record.attempts[id] || null;
          if (attempt) { delete record.attempts[id]; changed = true; }
          return attempt;
        }
      });
      if (compromised) throw storageError();
      if (changed) {
        const payload = await protection.seal(record, binding);
        const temporary = path.join(root, `.${key}.${randomUUID()}.tmp`);
        let output;
        try {
          output = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, fileMode);
          await output.writeFile(`${JSON.stringify({ schemaVersion: 1, payload })}\n`, "utf8");
          await output.sync();
          await output.close();
          output = null;
          if (compromised) throw storageError();
          await rename(temporary, file);
        } finally {
          await output?.close();
          await rm(temporary, { force: true });
        }
      }
      return result;
    } finally { if (!compromised) await release(); }
  }
  return Object.freeze({ withConnection });
}

export { createFileConnectionStore };
