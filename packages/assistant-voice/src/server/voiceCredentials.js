import crypto from "node:crypto";
import { readFileSync, statSync } from "node:fs";

// The host writes this file; the voice service holds only each token's SHA-256.
const VOICE_CREDENTIALS_SCHEMA = "jskit.assistant-voice.credentials.v1";
const VOICE_CLIENT_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
// RFC 6750's b64token, at least 32 characters, so a token is a real secret.
const VOICE_TOKEN_PATTERN = /^[A-Za-z0-9._~+/-]{32,1024}=*$/u;
const MAXIMUM_CLIENTS = 10_000;
const MAXIMUM_TOKENS_PER_CLIENT = 8;
const MAXIMUM_CREDENTIALS_BYTES = 4 * 1024 * 1024;
const CLIENT_FIELDS = new Set(["tokenSha256", "maximumConnections"]);

function credentialsError(message) {
  return Object.assign(new Error(`Voice credentials: ${message}`), { code: "voice_credentials_invalid" });
}

/** A client token's SHA-256, as the credentials file lists it: lowercase hex of its UTF-8 bytes. */
function voiceTokenSha256(token = "") {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

/** A new random client token (32 bytes, base64url). */
function createVoiceClientToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function isVoiceClientToken(token = "") {
  return VOICE_TOKEN_PATTERN.test(String(token));
}

function bearerVoiceAccessToken(headers = {}) {
  const value = String(headers.authorization || "").trim();
  const match = /^Bearer\s+([^\s]+)$/iu.exec(value);
  return match ? match[1] : "";
}

/**
 * Checks a credentials document and answers its clients by token hash.
 * @param {unknown} document
 * @returns {Map<string, { client: string, maximumConnections?: number }>} Each token hash's client.
 */
function parseVoiceCredentials(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) throw credentialsError("the file must hold a JSON object.");
  if (document.schema !== VOICE_CREDENTIALS_SCHEMA) throw credentialsError(`schema must be ${VOICE_CREDENTIALS_SCHEMA}.`);
  const unknown = Object.keys(document).filter(key => !["schema", "clients"].includes(key));
  if (unknown.length) throw credentialsError(`unknown field ${unknown[0]}.`);
  const { clients } = document;
  if (!clients || typeof clients !== "object" || Array.isArray(clients)) throw credentialsError("clients must be an object keyed by client name.");
  const names = Object.keys(clients);
  if (names.length > MAXIMUM_CLIENTS) throw credentialsError(`at most ${MAXIMUM_CLIENTS} clients.`);
  const byHash = new Map();
  for (const client of names) {
    if (!VOICE_CLIENT_PATTERN.test(client)) throw credentialsError(`client name ${JSON.stringify(client.slice(0, 80))} must be 1 to 64 lowercase letters, digits, dots, dashes or underscores.`);
    const entry = clients[client];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw credentialsError(`client ${client} must be an object.`);
    const extra = Object.keys(entry).find(key => !CLIENT_FIELDS.has(key));
    if (extra) throw credentialsError(`client ${client} has an unknown field ${extra}.`);
    const hashes = entry.tokenSha256;
    if (!Array.isArray(hashes) || !hashes.length || hashes.length > MAXIMUM_TOKENS_PER_CLIENT) {
      throw credentialsError(`client ${client} needs tokenSha256: 1 to ${MAXIMUM_TOKENS_PER_CLIENT} token hashes.`);
    }
    const { maximumConnections } = entry;
    if (maximumConnections !== undefined && (!Number.isSafeInteger(maximumConnections) || maximumConnections < 1)) {
      throw credentialsError(`client ${client}'s maximumConnections must be a positive whole number.`);
    }
    for (const hash of hashes) {
      if (typeof hash !== "string" || !SHA256_PATTERN.test(hash)) throw credentialsError(`client ${client} has a token hash that is not 64 lowercase hex digits.`);
      if (byHash.has(hash)) throw credentialsError(`a token hash is listed twice (client ${client}).`);
      byHash.set(hash, Object.freeze({ client, ...(maximumConnections ? { maximumConnections } : {}) }));
    }
  }
  return byHash;
}

function fileIdentity(file) {
  const metadata = statSync(file);
  if (!metadata.isFile()) throw credentialsError(`${file} is not a file.`);
  if (metadata.size > MAXIMUM_CREDENTIALS_BYTES) throw credentialsError("the file is larger than 4 MiB.");
  return `${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`;
}

function readCredentialsFile(file) {
  let bytes;
  let document;
  try {
    bytes = readFileSync(file);
    document = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw credentialsError(`${file} could not be read as JSON (${error?.code || error?.name}).`);
  }
  return Object.freeze({
    byHash: parseVoiceCredentials(document),
    sha256: crypto.createHash("sha256").update(bytes).digest("hex")
  });
}

const NO_CREDENTIALS = Object.freeze({ byHash: new Map(), sha256: null });

// Each client's tokens and limit, to tell which clients a reload added, removed or changed.
function clientTerms(byHash) {
  const terms = new Map();
  for (const [hash, { client, maximumConnections }] of byHash) {
    const entry = terms.get(client) || { hashes: [], maximumConnections };
    entry.hashes.push(hash);
    terms.set(client, entry);
  }
  return new Map([...terms].map(([client, { hashes, maximumConnections }]) => [client, `${hashes.sort().join(",")}/${maximumConnections ?? ""}`]));
}

/**
 * What a reload changed: the clients it added, removed or changed (tokens or limit).
 * @returns {{ clients: number, clientsAdded: string[], clientsRemoved: string[], clientsChanged: string[] }}
 */
function credentialChanges(previous, next) {
  const before = clientTerms(previous.byHash);
  const after = clientTerms(next.byHash);
  return {
    clients: after.size,
    clientsAdded: [...after.keys()].filter(client => !before.has(client)).sort(),
    clientsRemoved: [...before.keys()].filter(client => !after.has(client)).sort(),
    clientsChanged: [...after].filter(([client, terms]) => before.has(client) && before.get(client) !== terms).map(([client]) => client).sort()
  };
}

/**
 * The credentials a voice service accepts, read from the host's file and read
 * again whenever the file changes. A file that becomes invalid keeps the last
 * valid credentials and is reported; a file that disappears accepts no one.
 * @param {object} options
 * @param {string} options.file
 * @param {number} [options.pollIntervalMs]
 * @param {(reason: string) => void} options.onRefused Called when a changed file cannot be used.
 * @param {(changes: ReturnType<typeof credentialChanges>) => void} options.onChange Called once the accepted credentials changed, at start too.
 */
function createVoiceCredentialStore({ file, pollIntervalMs = 1000, onRefused, onChange }) {
  const path = String(file || "").trim();
  if (!path) throw new TypeError("A voice service needs its credentials file.");
  let current = NO_CREDENTIALS;
  let identity = "";
  let timer = null;

  function apply(next) {
    const previous = current;
    current = next;
    onChange(credentialChanges(previous, next));
  }

  function poll() {
    let next;
    try {
      next = fileIdentity(path);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        if (identity !== "unreadable") onRefused(error.message);
        identity = "unreadable";
        return;
      }
      if (identity === "missing") return;
      identity = "missing";
      apply(NO_CREDENTIALS);
      return;
    }
    if (next === identity) return;
    identity = next;
    let credentials;
    try {
      credentials = readCredentialsFile(path);
    } catch (error) {
      onRefused(error.message);
      return;
    }
    apply(credentials);
  }

  function start() {
    identity = fileIdentity(path);
    apply(readCredentialsFile(path));
    timer = setInterval(poll, pollIntervalMs);
    timer.unref();
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  /** The client a bearer token names, with the token's hash, or null. */
  function principalFor(token = "") {
    if (!isVoiceClientToken(token)) return null;
    const tokenSha256 = voiceTokenSha256(token);
    const credential = current.byHash.get(tokenSha256);
    return credential ? { ...credential, tokenSha256 } : null;
  }

  /** Whether a token hash still names the same client. */
  function accepts(tokenSha256, client) {
    return current.byHash.get(tokenSha256)?.client === client;
  }

  return Object.freeze({
    accepts,
    principalFor,
    start,
    stop,
    /** The SHA-256 of the file bytes in use, or null when the file is missing. */
    get sha256() { return current.sha256; }
  });
}

export {
  VOICE_CREDENTIALS_SCHEMA,
  bearerVoiceAccessToken,
  createVoiceClientToken,
  createVoiceCredentialStore,
  isVoiceClientToken,
  parseVoiceCredentials,
  voiceTokenSha256
};
