import fs from "node:fs/promises";
import path from "node:path";

const USER_FILE = "users.passwd";
const SESSION_FILE = "sessions.passwd";
const RECOVERY_FILE = "recovery.passwd";
const LOCK_FILE = "store.lock";
const JOURNAL_FILE = "transaction.journal";
const LOCK_STALE_MS = 30_000;

function nowIso() {
  return new Date().toISOString();
}

function encodeField(value) {
  return Buffer.from(String(value ?? ""), "utf8").toString("base64url");
}

function decodeField(value) {
  return Buffer.from(String(value || ""), "base64url").toString("utf8");
}

function splitLine(line, expectedType) {
  const parts = String(line || "").split(":");
  if (parts[0] !== expectedType || parts[1] !== "v1") {
    throw new Error(`Invalid ${expectedType} record.`);
  }
  return parts;
}

function parseUsers(content) {
  const users = [];
  for (const line of String(content || "").split("\n").filter(Boolean)) {
    const parts = splitLine(line, "user");
    if (parts.length !== 12) {
      throw new Error("Invalid user record field count.");
    }
    users.push({
      id: parts[2],
      email: decodeField(parts[3]),
      displayName: decodeField(parts[4]),
      password: {
        algorithm: parts[5],
        version: parts[6],
        salt: parts[7],
        hash: parts[8]
      },
      createdAt: decodeField(parts[9]),
      updatedAt: decodeField(parts[10]),
      disabled: parts[11] === "1"
    });
  }
  return users;
}

function serializeUsers(users) {
  return [...users]
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .map((user) =>
      [
        "user",
        "v1",
        user.id,
        encodeField(user.email),
        encodeField(user.displayName),
        user.password.algorithm,
        user.password.version,
        user.password.salt,
        user.password.hash,
        encodeField(user.createdAt),
        encodeField(user.updatedAt),
        user.disabled ? "1" : "0"
      ].join(":")
    )
    .join("\n") + (users.length > 0 ? "\n" : "");
}

function parseSessions(content) {
  const sessions = [];
  for (const line of String(content || "").split("\n").filter(Boolean)) {
    const parts = splitLine(line, "session");
    if (parts.length !== 9) {
      throw new Error("Invalid session record field count.");
    }
    sessions.push({
      id: parts[2],
      userId: parts[3],
      tokenHash: parts[4],
      purpose: parts[5] || "normal",
      createdAt: decodeField(parts[6]),
      expiresAt: decodeField(parts[7]),
      revokedAt: decodeField(parts[8] || "")
    });
  }
  return sessions;
}

function serializeSessions(sessions) {
  return [...sessions]
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .map((session) =>
      [
        "session",
        "v1",
        session.id,
        session.userId,
        session.tokenHash,
        session.purpose || "normal",
        encodeField(session.createdAt),
        encodeField(session.expiresAt),
        encodeField(session.revokedAt || "")
      ].join(":")
    )
    .join("\n") + (sessions.length > 0 ? "\n" : "");
}

function parseRecovery(content) {
  const records = [];
  for (const line of String(content || "").split("\n").filter(Boolean)) {
    const parts = splitLine(line, "recovery");
    if (parts.length !== 8) {
      throw new Error("Invalid recovery record field count.");
    }
    records.push({
      id: parts[2],
      userId: parts[3],
      tokenHash: parts[4],
      createdAt: decodeField(parts[5]),
      expiresAt: decodeField(parts[6]),
      usedAt: decodeField(parts[7] || "")
    });
  }
  return records;
}

function serializeRecovery(records) {
  return [...records]
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .map((record) =>
      [
        "recovery",
        "v1",
        record.id,
        record.userId,
        record.tokenHash,
        encodeField(record.createdAt),
        encodeField(record.expiresAt),
        encodeField(record.usedAt || "")
      ].join(":")
    )
    .join("\n") + (records.length > 0 ? "\n" : "");
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
    if (![USER_FILE, SESSION_FILE, RECOVERY_FILE].includes(name)) {
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
      if (Date.now() - startedAt > timeoutMs) {
        if (await removeStaleLock(lockPath)) {
          continue;
        }
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
          throw new Error("Local auth user already exists.");
        }
        const user = {
          ...clone(input),
          createdAt: input.createdAt || nowIso(),
          updatedAt: input.updatedAt || nowIso(),
          disabled: input.disabled === true
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
      }
    }),
    sessions: Object.freeze({
      async create(input) {
        const session = {
          ...clone(input),
          purpose: input.purpose || "normal",
          createdAt: input.createdAt || nowIso(),
          revokedAt: input.revokedAt || ""
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
          return clone(record || null);
        }
        record.usedAt = nowIso();
        mark("recovery");
        return clone(record);
      },
      async consumeForUser(userId) {
        let count = 0;
        for (const record of state.recovery) {
          if (record.userId === userId && !record.usedAt) {
            record.usedAt = nowIso();
            count += 1;
          }
        }
        if (count > 0) {
          mark("recovery");
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
        recovery: parseRecovery(await readText(path.join(resolvedStoreDir, RECOVERY_FILE)))
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
