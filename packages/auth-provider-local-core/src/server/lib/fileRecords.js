// The local file backend's records: one line per record, `type:v1:` then its
// fields, with free text base64url-encoded so it cannot contain the separator.

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

function parseIdentities(content) {
  const identities = [];
  for (const line of String(content || "").split("\n").filter(Boolean)) {
    const parts = splitLine(line, "identity");
    if (parts.length !== 7) {
      throw new Error("Invalid identity record field count.");
    }
    identities.push({
      userId: parts[2],
      provider: parts[3],
      providerSubject: decodeField(parts[4]),
      email: decodeField(parts[5]),
      createdAt: decodeField(parts[6])
    });
  }
  return identities;
}

function serializeIdentities(identities) {
  return [...identities]
    .sort((left, right) =>
      `${left.provider}:${left.providerSubject}`.localeCompare(`${right.provider}:${right.providerSubject}`))
    .map((identity) =>
      [
        "identity",
        "v1",
        identity.userId,
        identity.provider,
        encodeField(identity.providerSubject),
        encodeField(identity.email),
        encodeField(identity.createdAt)
      ].join(":")
    )
    .join("\n") + (identities.length > 0 ? "\n" : "");
}

function parseOAuthAttempts(content) {
  const attempts = [];
  for (const line of String(content || "").split("\n").filter(Boolean)) {
    const parts = splitLine(line, "oauth_attempt");
    if (parts.length !== 12) {
      throw new Error("Invalid OAuth attempt record field count.");
    }
    attempts.push({
      browserKeyHash: parts[2],
      provider: parts[3],
      intent: parts[4],
      userId: parts[5],
      state: parts[6],
      nonce: parts[7],
      codeVerifier: parts[8],
      returnTo: decodeField(parts[9]),
      createdAt: decodeField(parts[10]),
      expiresAt: decodeField(parts[11])
    });
  }
  return attempts;
}

function serializeOAuthAttempts(attempts) {
  return [...attempts]
    .sort((left, right) => String(left.browserKeyHash).localeCompare(String(right.browserKeyHash)))
    .map((attempt) =>
      [
        "oauth_attempt",
        "v1",
        attempt.browserKeyHash,
        attempt.provider,
        attempt.intent,
        attempt.userId,
        attempt.state,
        attempt.nonce,
        attempt.codeVerifier,
        encodeField(attempt.returnTo),
        encodeField(attempt.createdAt),
        encodeField(attempt.expiresAt)
      ].join(":")
    )
    .join("\n") + (attempts.length > 0 ? "\n" : "");
}

function parseSignInFailures(content) {
  const records = [];
  for (const line of String(content || "").split("\n").filter(Boolean)) {
    const parts = splitLine(line, "sign_in_failure");
    if (parts.length !== 6) {
      throw new Error("Invalid sign-in failure record field count.");
    }
    records.push({
      email: decodeField(parts[2]),
      failures: Number(parts[3]),
      lastFailedAt: decodeField(parts[4]),
      lockedUntil: decodeField(parts[5] || "")
    });
  }
  return records;
}

function serializeSignInFailures(records) {
  return [...records]
    .sort((left, right) => String(left.email).localeCompare(String(right.email)))
    .map((record) =>
      [
        "sign_in_failure",
        "v1",
        encodeField(record.email),
        String(record.failures),
        encodeField(record.lastFailedAt),
        encodeField(record.lockedUntil || "")
      ].join(":")
    )
    .join("\n") + (records.length > 0 ? "\n" : "");
}

export {
  parseIdentities,
  parseOAuthAttempts,
  parseRecovery,
  parseSessions,
  parseSignInFailures,
  parseUsers,
  serializeIdentities,
  serializeOAuthAttempts,
  serializeRecovery,
  serializeSessions,
  serializeSignInFailures,
  serializeUsers
};
