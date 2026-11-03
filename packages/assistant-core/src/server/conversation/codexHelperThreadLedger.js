import crypto from "node:crypto";
import { link, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { normalizeNullableText } from "./normalize.js";

import { tryAcquireExclusiveFileLock } from "@jskit-ai/kernel/server/support";
import { createCodexHelperThreadRecordSchema } from "./codexHelperThreadRecord.js";

const CODEX_HELPER_THREAD_LEDGER_DIRECTORY = "codex-helper-thread-ownership";
const CODEX_HELPER_THREAD_LEDGER_MAX_FILE_BYTES = 64 * 1024;
const CODEX_HELPER_THREAD_LEDGER_MAX_RECORDS = 1024;
const CODEX_HELPER_THREAD_LEDGER_LOCK_WAIT_MS = 5000;
const CODEX_HELPER_THREAD_LEDGER_LOCK_POLL_MS = 20;
function observeNoLock() {}

/**
 * The application retains its profile vocabulary and policy. Each owner retains its own mutation queue and
 * lock-instance identity.
 * @param {object} options
 * @param {(profile: unknown) => object} options.executionProfile The application's execution-profile codec.
 * @param {(profile: unknown) => object} [options.snapshotExecutionProfile]
 * @param {string} [options.errorPrefix]
 */
function createCodexHelperThreadLedgerOwner({
  executionProfile,
  snapshotExecutionProfile = executionProfile,
  errorPrefix = "codex_helper_"
}) {
  // readable-check: allow method-probe - input validation: the application must supply its execution-profile codec
  if (typeof executionProfile !== "function") {
    throw new TypeError("Codex helper ownership requires its execution-profile codec.");
  }
  const {
    ledgerError,
    assertExactKeys,
    requiredText,
    absolutePath,
    timestamp,
    positiveInteger,
    codexHelperThreadRecordId,
    defineCodexHelperThreadRecord
  } = createCodexHelperThreadRecordSchema({ executionProfile, errorPrefix });
  const codexHelperThreadLedgerMutationQueues = new Map();
  const codexHelperThreadLedgerProcessId = crypto.randomUUID();

  function codexHelperThreadLedgerRoot(projectRuntimeRoot = "") {
    return path.join(
      absolutePath(projectRuntimeRoot, "projectRuntimeRoot"),
      CODEX_HELPER_THREAD_LEDGER_DIRECTORY
    );
  }

  function recordsMatch(left = {}, right = {}) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function stableOwnershipMatches(left = {}, right = {}) {
    return left.createdAt === right.createdAt &&
      JSON.stringify(left.executionProfile) === JSON.stringify(right.executionProfile) &&
      JSON.stringify(left.identity) === JSON.stringify(right.identity) &&
      left.ownershipId === right.ownershipId &&
      left.projectContextRoot === right.projectContextRoot &&
      left.projectRuntimeRoot === right.projectRuntimeRoot &&
      left.sessionId === right.sessionId &&
      left.threadId === right.threadId &&
      left.workdir === right.workdir;
  }

  function delay(milliseconds = 0) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function readBoundedFile(
    filePath = "",
    maxBytes = CODEX_HELPER_THREAD_LEDGER_MAX_FILE_BYTES
  ) {
    const handle = await open(filePath, "r");
    try {
      const buffer = Buffer.alloc(maxBytes + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > maxBytes) {
        throw ledgerError(
          `Codex helper ownership state exceeds ${maxBytes} bytes: ${path.basename(filePath)}.`
        );
      }
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  }

  async function syncDirectory(directory = "") {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async function readRecordFile(filePath = "") {
    let value;
    try {
      value = JSON.parse(await readBoundedFile(filePath));
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw error;
      }
      throw ledgerError(
        `Codex helper ownership record cannot be read: ${path.basename(filePath)} (${error.message})`
      );
    }
    const record = defineCodexHelperThreadRecord(value);
    if (path.basename(filePath) !== `${codexHelperThreadRecordId(record)}.json`) {
      throw ledgerError(
        `Codex helper ownership record filename does not match its identity: ${path.basename(filePath)}.`
      );
    }
    return record;
  }

  async function withMutationQueue(key = "", callback = async () => undefined) {
    const previous = codexHelperThreadLedgerMutationQueues.get(key) || Promise.resolve();
    let release = () => undefined;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    codexHelperThreadLedgerMutationQueues.set(key, current);
    await previous.catch(() => null);
    try {
      return await callback();
    } finally {
      release();
      if (codexHelperThreadLedgerMutationQueues.get(key) === current) {
        codexHelperThreadLedgerMutationQueues.delete(key);
      }
    }
  }

  function defineLockOwner(value = {}) {
    assertExactKeys(
      value,
      ["createdAt", "pid", "processId", "token"],
      "Codex helper ownership lock"
    );
    return Object.freeze({
      createdAt: timestamp(value.createdAt, "lock.createdAt"),
      pid: positiveInteger(value.pid, "lock.pid"),
      processId: requiredText(value.processId, "lock.processId", 128),
      token: requiredText(value.token, "lock.token", 128)
    });
  }

  async function readLockOwner(lockPath = "") {
    try {
      return defineLockOwner(JSON.parse(await readBoundedFile(lockPath, 4096)));
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw error;
      }
      throw ledgerError(
        `Codex helper ownership lock cannot be verified: ${path.basename(lockPath)} (${error.message})`
      );
    }
  }

  function lockOwnerIsAlive(owner = {}) {
    try {
      process.kill(owner.pid, 0);
      return true;
    } catch (error) {
      if (error?.code === "ESRCH") {
        return false;
      }
      if (error?.code === "EPERM") {
        return true;
      }
      throw error;
    }
  }

  async function acquireHostLock(root = "", recordId = "", {
    observeLock = observeNoLock
  } = {}) {
    const lockPath = path.join(
      root,
      `.${requiredText(recordId, "recordId", 128)}.host-lock`
    );
    const deadline = Date.now() + CODEX_HELPER_THREAD_LEDGER_LOCK_WAIT_MS;
    while (true) {
      let releaseFileLock = null;
      try {
        releaseFileLock = await tryAcquireExclusiveFileLock(lockPath, { cwd: root });
        if (!releaseFileLock) {
          await observeLock({ stage: "host-contended" });
          if (Date.now() >= deadline) {
            throw ledgerError(
              "Codex helper ownership is busy in another process.",
              `${errorPrefix}ledger_busy`
            );
          }
          await delay(CODEX_HELPER_THREAD_LEDGER_LOCK_POLL_MS);
          continue;
        }
        await observeLock({ stage: "host-acquired" });
        let released = false;
        return async () => {
          if (released) {
            return;
          }
          released = true;
          try {
            await releaseFileLock();
          } catch (error) {
            throw ledgerError(`Codex helper ownership host lock failed: ${error.message}`);
          }
        };
      } catch (error) {
        throw typeof error?.code === "string" && error.code.startsWith(errorPrefix)
          ? error
          : ledgerError(`Codex helper ownership host lock failed: ${error.message}`);
      }
    }
  }

  async function acquireFilesystemLock(root = "", recordId = "", {
    observeLock = observeNoLock
  } = {}) {
    const locksRoot = path.join(root, ".locks");
    await mkdir(locksRoot, { mode: 0o770, recursive: true });
    const releaseHostLock = await acquireHostLock(root, recordId, { observeLock });
    try {
      const lockPath = path.join(locksRoot, `${requiredText(recordId, "recordId", 128)}.lock`);
      const deadline = Date.now() + CODEX_HELPER_THREAD_LEDGER_LOCK_WAIT_MS;
      const owner = defineLockOwner({
        createdAt: new Date().toISOString(),
        pid: process.pid,
        processId: codexHelperThreadLedgerProcessId,
        token: crypto.randomUUID()
      });
      const candidatePath = `${lockPath}.${owner.token}.candidate`;
      const candidateHandle = await open(candidatePath, "wx", 0o660);
      try {
        await candidateHandle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
        await candidateHandle.sync();
      } finally {
        await candidateHandle.close();
      }
      await syncDirectory(locksRoot);
      try {
        while (true) {
          try {
            await link(candidatePath, lockPath);
            await syncDirectory(locksRoot);
            break;
          } catch (error) {
            if (error?.code !== "EEXIST") {
              throw error;
            }
            let current;
            try {
              current = await readLockOwner(lockPath);
            } catch (readError) {
              if (readError?.code === "ENOENT") {
                continue;
              }
              throw readError;
            }
            if (!lockOwnerIsAlive(current)) {
              const verified = await readLockOwner(lockPath).catch((readError) => {
                if (readError?.code === "ENOENT") {
                  return null;
                }
                throw readError;
              });
              if (verified?.token === current.token) {
                await observeLock({ stage: "stale-verified" });
                await rm(lockPath).catch((removeError) => {
                  if (removeError?.code !== "ENOENT") {
                    throw removeError;
                  }
                });
                await syncDirectory(locksRoot);
              }
              continue;
            }
            if (Date.now() >= deadline) {
              throw ledgerError(
                "Codex helper ownership is busy in another process.",
                `${errorPrefix}ledger_busy`
              );
            }
            await delay(CODEX_HELPER_THREAD_LEDGER_LOCK_POLL_MS);
          }
        }
      } finally {
        await rm(candidatePath, { force: true }).catch(() => null);
        await syncDirectory(locksRoot);
      }
      return async () => {
        try {
          const current = await readLockOwner(lockPath);
          if (current.token !== owner.token || current.processId !== owner.processId) {
            throw ledgerError(
              "Codex helper ownership lock changed before it could be released.",
              `${errorPrefix}ledger_conflict`
            );
          }
          await rm(lockPath);
          await syncDirectory(locksRoot);
        } finally {
          await releaseHostLock();
        }
      };
    } catch (error) {
      await releaseHostLock();
      throw error;
    }
  }

  async function withFilesystemMutationLock(
    root = "",
    callback = async () => undefined,
    options = {}
  ) {
    const key = `${root}\0ledger`;
    return withMutationQueue(key, async () => {
      const release = await acquireFilesystemLock(root, "ledger", options);
      try {
        return await callback();
      } finally {
        await release();
      }
    });
  }

  function createCodexHelperThreadLedger({
    observeLock = observeNoLock,
    projectRuntimeRoot = ""
  } = {}) {
    const normalizedProjectRuntimeRoot = absolutePath(projectRuntimeRoot, "projectRuntimeRoot");
    const root = codexHelperThreadLedgerRoot(normalizedProjectRuntimeRoot);

    async function readAll() {
      let entries;
      try {
        entries = await readdir(root, { withFileTypes: true });
      } catch (error) {
        if (error?.code === "ENOENT") {
          return { failures: [], records: [] };
        }
        throw error;
      }
      const recordEntries = entries.filter(
        (entry) => entry.isFile() && entry.name.endsWith(".json")
      );
      if (recordEntries.length > CODEX_HELPER_THREAD_LEDGER_MAX_RECORDS) {
        return {
          failures: [Object.freeze({
            code: `${errorPrefix}ledger_invalid`,
            error: `Codex helper ownership ledger exceeds ${CODEX_HELPER_THREAD_LEDGER_MAX_RECORDS} records.`,
            fileName: "",
            retryable: true
          })],
          records: []
        };
      }
      const failures = [];
      const records = [];
      for (const entry of recordEntries.sort((left, right) => left.name.localeCompare(right.name))) {
        const filePath = path.join(root, entry.name);
        try {
          records.push(await readRecordFile(filePath));
        } catch (error) {
          failures.push(Object.freeze({
            code: normalizeNullableText(error?.code),
            error: normalizeNullableText(error?.message || error),
            fileName: entry.name,
            retryable: true
          }));
        }
      }
      return { failures, records };
    }

    async function write(recordValue = {}, { expected = null } = {}) {
      const record = defineCodexHelperThreadRecord(recordValue);
      const expectedRecord = expected ? defineCodexHelperThreadRecord(expected) : null;
      if (record.projectRuntimeRoot !== normalizedProjectRuntimeRoot) {
        throw ledgerError("Codex helper ownership project runtime root does not match its ledger.");
      }
      const recordId = codexHelperThreadRecordId(record);
      if (expectedRecord && codexHelperThreadRecordId(expectedRecord) !== recordId) {
        throw ledgerError(
          "Codex helper ownership identity cannot change during an update.",
          `${errorPrefix}ledger_conflict`
        );
      }
      if (!expectedRecord && record.revision !== 1) {
        throw ledgerError("New Codex helper ownership must start at revision 1.");
      }
      if (expectedRecord && (
        record.revision !== expectedRecord.revision + 1 ||
        Date.parse(record.updatedAt) < Date.parse(expectedRecord.updatedAt) ||
        !stableOwnershipMatches(record, expectedRecord)
      )) {
        throw ledgerError(
          "Codex helper ownership update changed immutable identity, revision, or time.",
          `${errorPrefix}ledger_conflict`
        );
      }
      const filePath = path.join(root, `${recordId}.json`);
      await mkdir(root, { mode: 0o770, recursive: true });
      return withFilesystemMutationLock(root, async () => {
        if (expectedRecord) {
          let current;
          try {
            current = await readRecordFile(filePath);
          } catch (error) {
            if (error?.code === "ENOENT") {
              throw ledgerError(
                "Codex helper ownership changed before it could be updated.",
                `${errorPrefix}ledger_conflict`
              );
            }
            throw error;
          }
          if (!recordsMatch(current, expectedRecord)) {
            throw ledgerError(
              "Codex helper ownership changed before it could be updated.",
              `${errorPrefix}ledger_conflict`
            );
          }
        } else {
          const entries = await readdir(root, { withFileTypes: true });
          const recordCount = entries.filter(
            (entry) => entry.isFile() && entry.name.endsWith(".json")
          ).length;
          if (recordCount >= CODEX_HELPER_THREAD_LEDGER_MAX_RECORDS) {
            throw ledgerError(
              `Codex helper ownership ledger cannot exceed ${CODEX_HELPER_THREAD_LEDGER_MAX_RECORDS} records.`
            );
          }
          try {
            await readBoundedFile(filePath);
            throw ledgerError(
              "Codex helper ownership already exists for this thread.",
              `${errorPrefix}ledger_conflict`
            );
          } catch (error) {
            if (error?.code !== "ENOENT") {
              throw error;
            }
          }
        }
        const serialized = `${JSON.stringify(record, null, 2)}\n`;
        if (Buffer.byteLength(serialized) > CODEX_HELPER_THREAD_LEDGER_MAX_FILE_BYTES) {
          throw ledgerError(
            `Codex helper ownership state exceeds ${CODEX_HELPER_THREAD_LEDGER_MAX_FILE_BYTES} bytes.`
          );
        }
        const temporaryPath = path.join(
          root,
          `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`
        );
        let handle = null;
        try {
          handle = await open(temporaryPath, "wx", 0o660);
          await handle.writeFile(serialized, "utf8");
          await handle.sync();
          await handle.close();
          handle = null;
          await rename(temporaryPath, filePath);
          await syncDirectory(root);
        } catch (error) {
          await handle?.close().catch(() => null);
          await rm(temporaryPath, { force: true }).catch(() => null);
          throw error;
        }
        return record;
      }, { observeLock });
    }

    async function remove(expectedValue = {}) {
      const expected = defineCodexHelperThreadRecord(expectedValue);
      const recordId = codexHelperThreadRecordId(expected);
      const filePath = path.join(root, `${recordId}.json`);
      await mkdir(root, { mode: 0o770, recursive: true });
      return withFilesystemMutationLock(root, async () => {
        let current;
        try {
          current = await readRecordFile(filePath);
        } catch (error) {
          if (error?.code === "ENOENT") {
            throw ledgerError(
              "Codex helper ownership changed before it could be removed.",
              `${errorPrefix}ledger_conflict`
            );
          }
          throw error;
        }
        if (!recordsMatch(current, expected)) {
          throw ledgerError(
            "Codex helper ownership changed before it could be removed.",
            `${errorPrefix}ledger_conflict`
          );
        }
        await rm(filePath);
        await syncDirectory(root);
        return true;
      }, { observeLock });
    }

    return Object.freeze({
      projectRuntimeRoot: normalizedProjectRuntimeRoot,
      readAll,
      remove,
      root,
      write
    });
  }

  function matchesExecutionProfile(recorded = {}, expected = {}) {
    return JSON.stringify(recorded) === JSON.stringify(
      snapshotExecutionProfile(expected)
    );
  }

  return Object.freeze({
    snapshotExecutionProfile,
    matchesExecutionProfile,
    codexHelperThreadRecordId,
    createCodexHelperThreadLedger,
    defineCodexHelperThreadRecord
  });
}

export {
  createCodexHelperThreadLedgerOwner
};
