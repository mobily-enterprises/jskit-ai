import fs from "node:fs/promises";
import path from "node:path";
import { ConflictError } from "@jskit-ai/kernel/server/runtime/errors";
import {
  parseIdentities,
  parseOAuthAttempts,
  parsePasses,
  parseRecovery,
  parseRegistrations,
  parseSecondFactors,
  parseSessions,
  parseSignInFailures,
  parseUsers,
  serializeIdentities,
  serializeOAuthAttempts,
  serializePasses,
  serializeRecovery,
  serializeRegistrations,
  serializeSecondFactors,
  serializeSessions,
  serializeSignInFailures,
  serializeUsers
} from "./fileRecords.js";

const USER_FILE = "users.passwd";
const SESSION_FILE = "sessions.passwd";
const RECOVERY_FILE = "recovery.passwd";
const IDENTITY_FILE = "identities.passwd";
const OAUTH_ATTEMPT_FILE = "oauth-attempts.passwd";
const SIGN_IN_FAILURE_FILE = "sign-in-failures.passwd";
const REGISTRATION_FILE = "registrations.passwd";
const SECOND_FACTOR_FILE = "second-factors.passwd";
const PASS_FILE = "passes.passwd";
const LOCK_FILE = "store.lock";
const JOURNAL_FILE = "transaction.journal";
const LOCK_STALE_MS = 30_000;

function nowIso() {
  return new Date().toISOString();
}

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function writeAtomic(filePath, content) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const handle = await fs.open(tmpPath, "w", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmpPath, filePath);
}

function encodeJournalContent(content) {
  return Buffer.from(String(content || ""), "utf8").toString("base64url");
}

function decodeJournalContent(content) {
  return Buffer.from(String(content || ""), "base64url").toString("utf8");
}

function buildJournal(entries) {
  return `${JSON.stringify({
    version: 1,
    files: entries.map((entry) => ({
      name: entry.name,
      content: encodeJournalContent(entry.content)
    }))
  })}\n`;
}

function parseJournal(content) {
  const parsed = JSON.parse(String(content || "{}"));
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.files)) {
    throw new Error("Invalid local auth transaction journal.");
  }
  return parsed.files.map((entry) => {
    const name = String(entry?.name || "").trim();
    const files = [
      USER_FILE,
      SESSION_FILE,
      RECOVERY_FILE,
      IDENTITY_FILE,
      OAUTH_ATTEMPT_FILE,
      SIGN_IN_FAILURE_FILE,
      REGISTRATION_FILE,
      SECOND_FACTOR_FILE,
      PASS_FILE
    ];
    if (!files.includes(name)) {
      throw new Error("Invalid local auth transaction journal file.");
    }
    return {
      name,
      content: decodeJournalContent(entry?.content)
    };
  });
}

async function writeCommitJournal(storeDir, entries) {
  if (entries.length < 1) {
    return;
  }
  await writeAtomic(path.join(storeDir, JOURNAL_FILE), buildJournal(entries));
}

async function replayCommitJournal(storeDir) {
  const journalPath = path.join(storeDir, JOURNAL_FILE);
  let journalContent;
  try {
    journalContent = await fs.readFile(journalPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  const entries = parseJournal(journalContent);
  for (const entry of entries) {
    await writeAtomic(path.join(storeDir, entry.name), entry.content);
  }
  await fs.rm(journalPath, { force: true });
}

function parseLockPid(content) {
  const pid = Number(String(content || "").split(":")[0]);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

function isProcessAlive(pid) {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function removeStaleLock(lockPath) {
  let stat;
  try {
    stat = await fs.stat(lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return true;
    }
    throw error;
  }

  const isOld = Date.now() - Number(stat.mtimeMs || 0) > LOCK_STALE_MS;
  if (!isOld) {
    return false;
  }

  const content = await readText(lockPath);
  const pid = parseLockPid(content);
  if (pid && isProcessAlive(pid)) {
    return false;
  }

  await fs.rm(lockPath, { force: true });
  return true;
}

async function acquireLock(storeDir, timeoutMs = 2000) {
  const lockPath = path.join(storeDir, LOCK_FILE);
  const startedAt = Date.now();
  while (true) {
    try {
      const handle = await fs.open(lockPath, "wx", 0o600);
      await handle.writeFile(`${process.pid}:${new Date().toISOString()}\n`);
      return async () => {
        await handle.close();
        await fs.rm(lockPath, { force: true });
      };
    } catch (error) {
      if (!error || error.code !== "EEXIST") {
        throw new Error(`Could not acquire local auth store lock at ${lockPath}.`);
      }
      // A lock older than LOCK_STALE_MS whose process has ended was left by a crash: take it over at once instead of
      // after waiting out the timeout. A lock whose process is alive, or a recent one, is never removed.
      if (await removeStaleLock(lockPath)) {
        continue;
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Could not acquire local auth store lock at ${lockPath}.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createTx(state, touched) {
  function mark(name) {
    touched.add(name);
  }

  return Object.freeze({
    users: Object.freeze({
      async create(input) {
        if (state.users.some((user) => user.id === input.id || user.email === input.email)) {
          throw new ConflictError("An account with this id or email already exists.", { code: "auth.local.accounts.exists" });
        }
        const user = {
          ...clone(input),
          createdAt: input.createdAt || nowIso(),
          updatedAt: input.updatedAt || nowIso(),
          disabled: input.disabled === true,
          pendingEmail: input.pendingEmail || ""
        };
        state.users.push(user);
        mark("users");
        return clone(user);
      },
      async findById(userId) {
        return clone(state.users.find((user) => user.id === userId) || null);
      },
      async findByEmail(email) {
        return clone(state.users.find((user) => user.email === email) || null);
      },
      async hasAny() {
        return state.users.length > 0;
      },
      async updatePassword(userId, passwordRecord) {
        const user = state.users.find((entry) => entry.id === userId);
        if (!user) {
          return null;
        }
        user.password = clone(passwordRecord);
        user.updatedAt = nowIso();
        mark("users");
        return clone(user);
      },
      async updateProfile(userId, updates = {}) {
        const user = state.users.find((entry) => entry.id === userId);
        if (!user) {
          return null;
        }
        if (typeof updates.displayName === "string") {
          user.displayName = updates.displayName;
        }
        user.updatedAt = nowIso();
        mark("users");
        return clone(user);
      },
      async updatePendingEmail(userId, pendingEmail) {
        const user = state.users.find((entry) => entry.id === userId);
        if (!user) {
          return null;
        }
        user.pendingEmail = String(pendingEmail || "");
        user.updatedAt = nowIso();
        mark("users");
        return clone(user);
      },
      async updateEmail(userId, email) {
        const user = state.users.find((entry) => entry.id === userId);
        if (!user) {
          return null;
        }
        if (state.users.some((entry) => entry.id !== userId && entry.email === email)) {
          throw new ConflictError("An account with this id or email already exists.", { code: "auth.local.accounts.exists" });
        }
        user.email = email;
        user.pendingEmail = "";
        user.updatedAt = nowIso();
        mark("users");
        return clone(user);
      }
    }),
    sessions: Object.freeze({
      async create(input) {
        const session = {
          ...clone(input),
          purpose: input.purpose || "normal",
          createdAt: input.createdAt || nowIso(),
          revokedAt: input.revokedAt || "",
          secondFactorAt: input.secondFactorAt || "",
          ip: input.ip || "",
          userAgent: input.userAgent || "",
          lastSeenAt: input.lastSeenAt || ""
        };
        state.sessions.push(session);
        mark("sessions");
        return clone(session);
      },
      async findById(sessionId) {
        return clone(state.sessions.find((session) => session.id === sessionId) || null);
      },
      async findByTokenHash(tokenHash) {
        return clone(state.sessions.find((session) => session.tokenHash === tokenHash) || null);
      },
      async revoke(sessionId) {
        const session = state.sessions.find((entry) => entry.id === sessionId);
        if (!session || session.revokedAt) {
          return clone(session || null);
        }
        session.revokedAt = nowIso();
        mark("sessions");
        return clone(session);
      },
      async revokeForUser(userId, options = {}) {
        const exceptSessionId = String(options.exceptSessionId || "");
        let count = 0;
        for (const session of state.sessions) {
          if (session.userId === userId && session.id !== exceptSessionId && !session.revokedAt) {
            session.revokedAt = nowIso();
            count += 1;
          }
        }
        if (count > 0) {
          mark("sessions");
        }
        return count;
      },
      async markSecondFactorProved(sessionId, secondFactorAt) {
        const session = state.sessions.find((entry) => entry.id === sessionId);
        if (!session) {
          return null;
        }
        session.secondFactorAt = secondFactorAt;
        mark("sessions");
        return clone(session);
      },
      async clearSecondFactorForUser(userId) {
        let count = 0;
        for (const session of state.sessions) {
          if (session.userId === userId && session.secondFactorAt) {
            session.secondFactorAt = "";
            count += 1;
          }
        }
        if (count > 0) {
          mark("sessions");
        }
        return count;
      },
      async touch(sessionId, { lastSeenAt, ip, userAgent }) {
        const session = state.sessions.find((entry) => entry.id === sessionId);
        if (!session) {
          return;
        }
        session.lastSeenAt = lastSeenAt;
        session.ip = ip || session.ip;
        session.userAgent = userAgent || session.userAgent;
        mark("sessions");
      }
    }),
    recovery: Object.freeze({
      async create(input) {
        const record = {
          ...clone(input),
          createdAt: input.createdAt || nowIso(),
          usedAt: input.usedAt || ""
        };
        state.recovery.push(record);
        mark("recovery");
        return clone(record);
      },
      async findByTokenHash(tokenHash) {
        return clone(state.recovery.find((record) => record.tokenHash === tokenHash) || null);
      },
      async consume(tokenId) {
        const record = state.recovery.find((entry) => entry.id === tokenId);
        if (!record || record.usedAt) {
          return null;
        }
        record.usedAt = nowIso();
        mark("recovery");
        return clone(record);
      },
      async consumeForUser(userId, { idPrefix } = {}) {
        if (typeof idPrefix !== "string" || !idPrefix) {
          throw new TypeError("recovery.consumeForUser() takes the idPrefix of the tokens it consumes, such as \"rec_\".");
        }
        let count = 0;
        for (const record of state.recovery) {
          if (record.userId === userId && !record.usedAt && record.id.startsWith(idPrefix)) {
            record.usedAt = nowIso();
            count += 1;
          }
        }
        if (count > 0) {
          mark("recovery");
        }
        return count;
      }
    }),
    identities: Object.freeze({
      async create(input) {
        if (state.identities.some((entry) =>
          entry.provider === input.provider && entry.providerSubject === input.providerSubject)) {
          throw new Error("Local auth identity already exists.");
        }
        const identity = {
          ...clone(input),
          createdAt: input.createdAt || nowIso()
        };
        state.identities.push(identity);
        mark("identities");
        return clone(identity);
      },
      async findByProviderSubject(provider, providerSubject) {
        return clone(state.identities.find((entry) =>
          entry.provider === provider && entry.providerSubject === providerSubject) || null);
      },
      async listForUser(userId) {
        return clone(state.identities.filter((entry) => entry.userId === userId));
      },
      async deleteForUser(userId, provider) {
        const before = state.identities.length;
        state.identities = state.identities.filter((entry) => !(entry.userId === userId && entry.provider === provider));
        const count = before - state.identities.length;
        if (count > 0) {
          mark("identities");
        }
        return count;
      }
    }),
    oauthAttempts: Object.freeze({
      async create(input) {
        const attempt = {
          ...clone(input),
          createdAt: input.createdAt || nowIso()
        };
        state.oauthAttempts.push(attempt);
        mark("oauthAttempts");
        return clone(attempt);
      },
      // Removes and returns the attempt; the store lock makes this single-use.
      async take(browserKeyHash) {
        const attempt = state.oauthAttempts.find((entry) => entry.browserKeyHash === browserKeyHash);
        if (!attempt) {
          return null;
        }
        state.oauthAttempts = state.oauthAttempts.filter((entry) => entry !== attempt);
        mark("oauthAttempts");
        return clone(attempt);
      },
      async deleteExpired(now) {
        const before = state.oauthAttempts.length;
        state.oauthAttempts = state.oauthAttempts.filter((entry) => Date.parse(entry.expiresAt) > Date.parse(now));
        const count = before - state.oauthAttempts.length;
        if (count > 0) {
          mark("oauthAttempts");
        }
        return count;
      }
    }),
    signInFailures: Object.freeze({
      async find(email) {
        return clone(state.signInFailures.find((record) => record.email === email) || null);
      },
      async save(record) {
        state.signInFailures = [
          ...state.signInFailures.filter((entry) => entry.email !== record.email),
          clone(record)
        ];
        mark("signInFailures");
        return clone(record);
      },
      async clear(email) {
        const before = state.signInFailures.length;
        state.signInFailures = state.signInFailures.filter((entry) => entry.email !== email);
        const count = before - state.signInFailures.length;
        if (count > 0) {
          mark("signInFailures");
        }
        return count;
      },
      async deleteBefore(lastFailedAt) {
        const before = state.signInFailures.length;
        const cutoff = Date.parse(lastFailedAt);
        state.signInFailures = state.signInFailures.filter((entry) => Date.parse(entry.lastFailedAt) >= cutoff);
        const count = before - state.signInFailures.length;
        if (count > 0) {
          mark("signInFailures");
        }
        return count;
      }
    }),
    secondFactors: Object.freeze({
      // The store lock holds every record until the transaction ends.
      async find(userId) {
        return clone(state.secondFactors.find((record) => record.userId === userId) || null);
      },
      async findMany(userIds) {
        const wanted = new Set(userIds);
        return clone(state.secondFactors.filter((record) => wanted.has(record.userId)));
      },
      async save(record) {
        state.secondFactors = [
          ...state.secondFactors.filter((entry) => entry.userId !== record.userId),
          clone(record)
        ];
        mark("secondFactors");
        return clone(record);
      },
      async delete(userId) {
        const before = state.secondFactors.length;
        state.secondFactors = state.secondFactors.filter((entry) => entry.userId !== userId);
        const count = before - state.secondFactors.length;
        if (count > 0) {
          mark("secondFactors");
        }
        return count;
      }
    }),
    registrations: Object.freeze({
      async save(record) {
        state.registrations = [
          ...state.registrations.filter((entry) => entry.email !== record.email),
          clone(record)
        ];
        mark("registrations");
        return clone(record);
      },
      async findByEmail(email) {
        return clone(state.registrations.find((record) => record.email === email) || null);
      },
      async findByTokenHash(tokenHash) {
        return clone(state.registrations.find((record) => record.tokenHash === tokenHash) || null);
      },
      async delete(email) {
        const before = state.registrations.length;
        state.registrations = state.registrations.filter((entry) => entry.email !== email);
        const count = before - state.registrations.length;
        if (count > 0) {
          mark("registrations");
        }
        return count;
      },
      async deleteExpired(now) {
        const before = state.registrations.length;
        state.registrations = state.registrations.filter((entry) => Date.parse(entry.expiresAt) > Date.parse(now));
        const count = before - state.registrations.length;
        if (count > 0) {
          mark("registrations");
        }
        return count;
      }
    }),
    passes: Object.freeze({
      // The store lock holds every record until the transaction ends, so of two uses of one pass only the first records it.
      async use({ id, expiresAt }) {
        if (state.passes.some((record) => record.id === id)) {
          return false;
        }
        state.passes.push({ id, expiresAt });
        mark("passes");
        return true;
      },
      async deleteExpired(now) {
        const before = state.passes.length;
        state.passes = state.passes.filter((record) => Date.parse(record.expiresAt) > Date.parse(now));
        const count = before - state.passes.length;
        if (count > 0) {
          mark("passes");
        }
        return count;
      }
    })
  });
}

function createLocalFileBackend({ storeDir }) {
  const resolvedStoreDir = path.resolve(String(storeDir || ".jskit/auth"));

  async function withTransaction(callback) {
    await fs.mkdir(resolvedStoreDir, { recursive: true, mode: 0o700 });
    const release = await acquireLock(resolvedStoreDir);
    try {
      await replayCommitJournal(resolvedStoreDir);
      const state = {
        users: parseUsers(await readText(path.join(resolvedStoreDir, USER_FILE))),
        sessions: parseSessions(await readText(path.join(resolvedStoreDir, SESSION_FILE))),
        recovery: parseRecovery(await readText(path.join(resolvedStoreDir, RECOVERY_FILE))),
        identities: parseIdentities(await readText(path.join(resolvedStoreDir, IDENTITY_FILE))),
        oauthAttempts: parseOAuthAttempts(await readText(path.join(resolvedStoreDir, OAUTH_ATTEMPT_FILE))),
        signInFailures: parseSignInFailures(await readText(path.join(resolvedStoreDir, SIGN_IN_FAILURE_FILE))),
        registrations: parseRegistrations(await readText(path.join(resolvedStoreDir, REGISTRATION_FILE))),
        secondFactors: parseSecondFactors(await readText(path.join(resolvedStoreDir, SECOND_FACTOR_FILE))),
        passes: parsePasses(await readText(path.join(resolvedStoreDir, PASS_FILE)))
      };
      const touched = new Set();
      const result = await callback(createTx(state, touched));
      const commitEntries = [];
      if (touched.has("users")) {
        commitEntries.push({
          name: USER_FILE,
          content: serializeUsers(state.users)
        });
      }
      if (touched.has("sessions")) {
        commitEntries.push({
          name: SESSION_FILE,
          content: serializeSessions(state.sessions)
        });
      }
      if (touched.has("recovery")) {
        commitEntries.push({
          name: RECOVERY_FILE,
          content: serializeRecovery(state.recovery)
        });
      }
      if (touched.has("identities")) {
        commitEntries.push({
          name: IDENTITY_FILE,
          content: serializeIdentities(state.identities)
        });
      }
      if (touched.has("oauthAttempts")) {
        commitEntries.push({
          name: OAUTH_ATTEMPT_FILE,
          content: serializeOAuthAttempts(state.oauthAttempts)
        });
      }
      if (touched.has("signInFailures")) {
        commitEntries.push({
          name: SIGN_IN_FAILURE_FILE,
          content: serializeSignInFailures(state.signInFailures)
        });
      }
      if (touched.has("registrations")) {
        commitEntries.push({
          name: REGISTRATION_FILE,
          content: serializeRegistrations(state.registrations)
        });
      }
      if (touched.has("secondFactors")) {
        commitEntries.push({
          name: SECOND_FACTOR_FILE,
          content: serializeSecondFactors(state.secondFactors)
        });
      }
      if (touched.has("passes")) {
        commitEntries.push({
          name: PASS_FILE,
          content: serializePasses(state.passes)
        });
      }
      if (commitEntries.length > 0) {
        await writeCommitJournal(resolvedStoreDir, commitEntries);
        for (const entry of commitEntries) {
          await writeAtomic(path.join(resolvedStoreDir, entry.name), entry.content);
        }
        await fs.rm(path.join(resolvedStoreDir, JOURNAL_FILE), { force: true });
      }
      return result;
    } finally {
      await release();
    }
  }

  return Object.freeze({
    storeDir: resolvedStoreDir,
    withTransaction
  });
}

export { createLocalFileBackend };
