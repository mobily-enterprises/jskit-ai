import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { URL } from "node:url";
import { AppError } from "@jskit-ai/server-runtime-core/errors";

const FOLLOW_STATUS_PENDING = "pending";
const FOLLOW_STATUS_ACCEPTED = "accepted";
const FOLLOW_STATUS_REJECTED = "rejected";
const FOLLOW_STATUS_UNDONE = "undone";

const SOCIAL_VISIBILITY_VALUES = new Set(["public", "unlisted", "followers", "direct"]);
const DEFAULT_FEDERATION_TIMEOUT_MS = 10000;
const DEFAULT_DELIVERY_BATCH_SIZE = 25;
const DEFAULT_DELIVERY_MAX_ATTEMPTS = 8;
const DEFAULT_RETRY_BASE_MS = 30_000;
const HTTP_SIGNATURE_HEADER_PATTERN = /(\w+)="([^"]*)"/g;
const DEFAULT_OUTBOX_POLL_SECONDS = 10;
const DEFAULT_OUTBOX_WORKSPACE_BATCH_SIZE = 25;
const LOCALHOST_HOSTNAME_SET = new Set(["localhost", "localhost.localdomain"]);

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeLowerText(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeHostname(value) {
  const normalized = normalizeLowerText(value).replace(/\.$/, "");
  if (!normalized) {
    return "";
  }

  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return normalized.slice(1, -1);
  }

  return normalized;
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 0;
  }
  return parsed;
}

function resolveWorkspaceId(workspace) {
  const workspaceId = toPositiveInteger(workspace?.id);
  if (!workspaceId) {
    throw new AppError(409, "Workspace selection required.");
  }

  return workspaceId;
}

function resolveActorUserId(actor) {
  const userId = toPositiveInteger(actor?.id);
  if (!userId) {
    throw new AppError(401, "Authentication required.");
  }

  return userId;
}

function normalizePostVisibility(value) {
  const normalized = normalizeLowerText(value) || "public";
  if (!SOCIAL_VISIBILITY_VALUES.has(normalized)) {
    throw new AppError(400, "Validation failed.", {
      details: {
        code: "SOCIAL_VALIDATION_FAILED",
        fieldErrors: {
          visibility: "Visibility must be one of: public, unlisted, followers, direct."
        }
      }
    });
  }
  return normalized;
}

function normalizeLimitedText(value, { fieldName, minLength = 0, maxLength = 5000 } = {}) {
  const normalized = String(value || "");
  const trimmed = normalized.trim();

  if (minLength > 0 && trimmed.length < minLength) {
    throw new AppError(400, "Validation failed.", {
      details: {
        code: "SOCIAL_VALIDATION_FAILED",
        fieldErrors: {
          [fieldName]: `${fieldName} must be at least ${minLength} characters.`
        }
      }
    });
  }

  if (trimmed.length > maxLength) {
    throw new AppError(400, "Validation failed.", {
      details: {
        code: "SOCIAL_VALIDATION_FAILED",
        fieldErrors: {
          [fieldName]: `${fieldName} must be at most ${maxLength} characters.`
        }
      }
    });
  }

  return trimmed;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function isTruthyBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (value == null) {
    return fallback;
  }

  const normalized = normalizeLowerText(value);
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }

  return fallback;
}

function resolveRuntimePolicy({ repositoryConfig = {}, env = {} } = {}) {
  const socialConfig = repositoryConfig?.social && typeof repositoryConfig.social === "object" ? repositoryConfig.social : {};
  const retryConfig = socialConfig.retry && typeof socialConfig.retry === "object" ? socialConfig.retry : {};
  const limitsConfig = socialConfig.limits && typeof socialConfig.limits === "object" ? socialConfig.limits : {};
  const moderationConfig =
    socialConfig.moderation && typeof socialConfig.moderation === "object" ? socialConfig.moderation : {};
  const identityConfig = socialConfig.identity && typeof socialConfig.identity === "object" ? socialConfig.identity : {};
  const workersConfig = socialConfig.workers && typeof socialConfig.workers === "object" ? socialConfig.workers : {};
  const normalizedModerationAccessMode =
    normalizeLowerText(moderationConfig.accessMode || "permission") === "operator" ? "operator" : "permission";
  const defaultBlockedDomains = new Set(
    normalizeStringArray(moderationConfig.defaultBlockedDomains).map((entry) => normalizeHostname(entry))
  );

  return {
    enabled: Boolean(socialConfig.enabled),
    federationEnabled: Boolean(socialConfig.federationEnabled),
    postMaxChars: Math.max(1, Number(limitsConfig.postMaxChars || 5000)),
    commentMaxChars: Math.max(1, Number(limitsConfig.commentMaxChars || 2000)),
    feedPageSizeMax: Math.max(1, Number(limitsConfig.feedPageSizeMax || 50)),
    commentsPageSizeMax: Math.max(1, Number(limitsConfig.commentsPageSizeMax || 50)),
    notificationsPageSizeMax: Math.max(1, Number(limitsConfig.notificationsPageSizeMax || 50)),
    actorSearchLimitMax: Math.max(1, Number(limitsConfig.actorSearchLimitMax || 50)),
    inboxMaxPayloadBytes: Math.max(1024, Number(limitsConfig.inboxMaxPayloadBytes || 1_000_000)),
    retryBaseMs: Math.max(1000, Number(retryConfig.baseDelayMs || env.SOCIAL_FEDERATION_RETRY_BASE_MS || DEFAULT_RETRY_BASE_MS)),
    retryMaxDelayMs: Math.max(1000, Number(retryConfig.maxDelayMs || retryConfig.baseDelayMs || DEFAULT_RETRY_BASE_MS * 60)),
    retryJitterRatio: Math.max(0, Math.min(1, Number(retryConfig.jitterRatio || 0.2))),
    maxAttempts: Math.max(1, Number(retryConfig.maxAttempts || env.SOCIAL_FEDERATION_DELIVERY_MAX_ATTEMPTS || DEFAULT_DELIVERY_MAX_ATTEMPTS)),
    deliveryBatchSize: Math.max(1, Number(env.SOCIAL_FEDERATION_DELIVERY_BATCH_SIZE || DEFAULT_DELIVERY_BATCH_SIZE)),
    outboxPollSeconds: Math.max(
      1,
      Number(env.SOCIAL_FEDERATION_OUTBOX_POLL_SECONDS || workersConfig.outboxPollSeconds || DEFAULT_OUTBOX_POLL_SECONDS)
    ),
    outboxWorkspaceBatchSize: Math.max(
      1,
      Number(
        env.SOCIAL_FEDERATION_OUTBOX_MAX_WORKSPACES_PER_TICK ||
          workersConfig.outboxWorkspaceBatchSize ||
          DEFAULT_OUTBOX_WORKSPACE_BATCH_SIZE
      )
    ),
    federationHttpTimeoutMs: Math.max(1000, Number(env.SOCIAL_FEDERATION_HTTP_TIMEOUT_MS || DEFAULT_FEDERATION_TIMEOUT_MS)),
    allowPrivateHosts: isTruthyBoolean(env.SOCIAL_FEDERATION_ALLOW_PRIVATE_HOSTS, false),
    signingSecret: normalizeText(env.SOCIAL_FEDERATION_SIGNING_SECRET),
    moderation: {
      accessMode: normalizedModerationAccessMode,
      requireManualApprovalForRemoteFollows: isTruthyBoolean(
        moderationConfig.requireManualApprovalForRemoteFollows,
        false
      ),
      autoSuspendOnRepeatedSignatureFailures: isTruthyBoolean(
        moderationConfig.autoSuspendOnRepeatedSignatureFailures,
        true
      ),
      signatureFailureSuspendThreshold: Math.max(1, Number(moderationConfig.signatureFailureSuspendThreshold || 5)),
      defaultBlockedDomains
    },
    identity: {
      treatHandleWithDomainAsRemote: isTruthyBoolean(identityConfig.treatHandleWithDomainAsRemote, true),
      allowRemoteLookupForLocalHandles: isTruthyBoolean(identityConfig.allowRemoteLookupForLocalHandles, false)
    }
  };
}

function buildObjectUri(appPublicUrl, objectId) {
  const normalizedBase = String(appPublicUrl || "").trim().replace(/\/+$/, "");
  if (!normalizedBase) {
    throw new Error("appPublicUrl is required for social object URI generation.");
  }

  const normalizedObjectId = normalizeText(objectId);
  if (!normalizedObjectId) {
    throw new Error("objectId is required for social object URI generation.");
  }
  return `${normalizedBase}/ap/objects/${encodeURIComponent(normalizedObjectId)}`;
}

function buildActivityUri(appPublicUrl, workspaceSlug, activityType, seed) {
  const normalizedBase = String(appPublicUrl || "").trim().replace(/\/+$/, "");
  const normalizedWorkspaceSlug = normalizeText(workspaceSlug) || "default";
  const normalizedType = normalizeLowerText(activityType) || "activity";
  const normalizedSeed = normalizeText(seed) || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return `${normalizedBase}/ap/${normalizedWorkspaceSlug}/activities/${normalizedType}/${encodeURIComponent(normalizedSeed)}`;
}

function resolveWorkspaceSlug(workspace, fallback = "") {
  const normalized = normalizeText(workspace?.slug || fallback);
  return normalized || "workspace";
}

function buildActorOutboxUrl(appPublicUrl, username) {
  const normalizedBase = String(appPublicUrl || "").trim().replace(/\/+$/, "");
  return `${normalizedBase}/ap/actors/${encodeURIComponent(String(username || "").trim())}/outbox`;
}

function buildActorHandle(publicChatId, fallbackUserId) {
  const normalizedPublicChatId = normalizeLowerText(publicChatId);
  if (normalizedPublicChatId) {
    return normalizedPublicChatId;
  }

  return `user-${toPositiveInteger(fallbackUserId) || "unknown"}`;
}

function canonicalizeLimitedUsername(value, { maxLength = 64, fallbackPrefix = "user" } = {}) {
  const normalized = normalizeLowerText(value).replace(/\s+/g, "");
  if (normalized && normalized.length <= maxLength) {
    return normalized;
  }
  if (normalized) {
    const hash = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 8);
    const prefixMaxLength = Math.max(1, maxLength - hash.length - 1);
    return `${normalized.slice(0, prefixMaxLength)}-${hash}`;
  }
  const fallbackHash = crypto
    .createHash("sha256")
    .update(`${fallbackPrefix}:${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 8);
  return `${fallbackPrefix}-${fallbackHash}`;
}

function parseRemoteHandleParts(value) {
  const normalized = normalizeLowerText(value).replace(/^@+/, "");
  if (!normalized || !normalized.includes("@")) {
    return null;
  }

  const parts = normalized.split("@");
  if (parts.length !== 2) {
    return null;
  }

  const username = normalizeLowerText(parts[0]);
  const domain = normalizeHostname(parts[1]);
  if (!username || !domain) {
    return null;
  }

  return {
    username,
    domain
  };
}

function buildRemoteUsername(preferredUsername, actorUri) {
  const normalizedBase = canonicalizeLimitedUsername(preferredUsername, {
    maxLength: 48,
    fallbackPrefix: "remote"
  });
  const domain = extractDomainFromActorUri(actorUri);
  if (!domain) {
    return canonicalizeLimitedUsername(normalizedBase, {
      maxLength: 64,
      fallbackPrefix: "remote"
    });
  }

  return canonicalizeLimitedUsername(`${normalizedBase}@${domain}`, {
    maxLength: 64,
    fallbackPrefix: "remote"
  });
}

function resolveObjectUriCandidates(rawObjectId, normalizedAppPublicUrl) {
  const normalizedObjectId = normalizeText(rawObjectId);
  if (!normalizedObjectId) {
    return [];
  }

  const normalizedBase = String(normalizedAppPublicUrl || "").trim().replace(/\/+$/, "");
  const encodedObjectId = encodeURIComponent(normalizedObjectId);
  const decodedObjectId = (() => {
    try {
      return decodeURIComponent(normalizedObjectId);
    } catch {
      return normalizedObjectId;
    }
  })();

  return [
    normalizedObjectId,
    decodedObjectId,
    `${normalizedBase}/ap/objects/${encodedObjectId}`,
    `${normalizedBase}/ap/objects/${encodeURIComponent(decodedObjectId)}`
  ].filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);
}

function extractDomainFromActorUri(actorUri) {
  const normalizedActorUri = normalizeText(actorUri);
  if (!normalizedActorUri) {
    return "";
  }

  try {
    const parsed = new URL(normalizedActorUri);
    return normalizeLowerText(parsed.hostname);
  } catch {
    return "";
  }
}

function createAesKey(signingSecret) {
  const normalizedSecret = normalizeText(signingSecret);
  if (!normalizedSecret) {
    return null;
  }

  return crypto.createHash("sha256").update(normalizedSecret).digest();
}

function encryptPrivateKey(privateKeyPem, signingSecret) {
  const key = createAesKey(signingSecret);
  if (!key) {
    return Buffer.from(String(privateKeyPem || ""), "utf8").toString("base64");
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(privateKeyPem || ""), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function decryptPrivateKey(privateKeyEncrypted, signingSecret) {
  const key = createAesKey(signingSecret);
  const payload = Buffer.from(String(privateKeyEncrypted || ""), "base64");
  if (!key) {
    return payload.toString("utf8");
  }

  if (payload.length < 28) {
    throw new Error("Encrypted private key payload is invalid.");
  }

  const iv = payload.subarray(0, 12);
  const authTag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function parseSignatureHeader(signatureHeader) {
  const normalizedSignatureHeader = normalizeText(signatureHeader);
  if (!normalizedSignatureHeader) {
    return null;
  }

  const result = {};
  for (const match of normalizedSignatureHeader.matchAll(HTTP_SIGNATURE_HEADER_PATTERN)) {
    result[match[1]] = match[2];
  }

  if (!result.keyId || !result.signature) {
    return null;
  }

  return {
    keyId: result.keyId,
    signature: result.signature,
    algorithm: normalizeLowerText(result.algorithm) || "rsa-sha256",
    headers: normalizeText(result.headers) || "(request-target) host date digest"
  };
}

function buildSigningString({ method, pathname, headers, signedHeaderList }) {
  const normalizedMethod = normalizeLowerText(method) || "post";
  const normalizedPathname = normalizeText(pathname) || "/";
  const normalizedHeaders = headers && typeof headers === "object" ? headers : {};

  const list = String(signedHeaderList || "(request-target) host date digest")
    .split(/\s+/)
    .map((entry) => normalizeLowerText(entry))
    .filter(Boolean);

  const lines = [];
  for (const headerName of list) {
    if (headerName === "(request-target)") {
      lines.push(`(request-target): ${normalizedMethod} ${normalizedPathname}`);
      continue;
    }

    const value = normalizeText(normalizedHeaders[headerName]);
    lines.push(`${headerName}: ${value}`);
  }

  return lines.join("\n");
}

function computeDigestHeader(rawBodyBuffer) {
  const digest = crypto.createHash("sha256").update(rawBodyBuffer).digest("base64");
  return `SHA-256=${digest}`;
}

function verifyDigestHeader({ rawBodyBuffer, digestHeader }) {
  const normalizedDigestHeader = normalizeText(digestHeader);
  if (!normalizedDigestHeader) {
    return false;
  }

  const expectedDigestHeader = computeDigestHeader(rawBodyBuffer);
  return normalizedDigestHeader === expectedDigestHeader;
}

function verifySignature({ signatureHeader, publicKeyPem, method, pathname, headers }) {
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed || !publicKeyPem) {
    return {
      signatureValid: false,
      keyId: parsed?.keyId || null,
      signingString: ""
    };
  }

  const signingString = buildSigningString({
    method,
    pathname,
    headers,
    signedHeaderList: parsed.headers
  });

  let signatureBuffer;
  try {
    signatureBuffer = Buffer.from(parsed.signature, "base64");
  } catch {
    return {
      signatureValid: false,
      keyId: parsed.keyId,
      signingString
    };
  }

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(signingString);
  verifier.end();

  const signatureValid = verifier.verify(publicKeyPem, signatureBuffer);
  return {
    signatureValid,
    keyId: parsed.keyId,
    signingString
  };
}

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || DEFAULT_FEDERATION_TIMEOUT_MS));
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
    }
  };
}

function isPrivateIpv4Address(ipAddress) {
  const octets = String(ipAddress || "")
    .split(".")
    .map((value) => Number(value));
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return true;
  }

  const [a, b] = octets;
  if (a === 10 || a === 127 || a === 0) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }

  return false;
}

function isPrivateIpv6Address(ipAddress) {
  const normalized = normalizeHostname(ipAddress);
  if (!normalized) {
    return true;
  }

  if (normalized === "::1") {
    return true;
  }
  if (normalized.startsWith("fe8:") || normalized.startsWith("fe9:") || normalized.startsWith("fea:") || normalized.startsWith("feb:")) {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }

  if (normalized.startsWith("::ffff:")) {
    const mappedIpv4 = normalized.slice("::ffff:".length);
    if (net.isIP(mappedIpv4) === 4) {
      return isPrivateIpv4Address(mappedIpv4);
    }
  }

  return false;
}

function isPrivateIpAddress(ipAddress) {
  const normalized = normalizeHostname(ipAddress);
  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) {
    return isPrivateIpv4Address(normalized);
  }
  if (ipVersion === 6) {
    return isPrivateIpv6Address(normalized);
  }
  return true;
}

function createBlockedRemoteHostError() {
  return new AppError(400, "Blocked remote host.", {
    details: {
      code: "SOCIAL_FEDERATION_FETCH_BLOCKED"
    }
  });
}

async function assertSafeFederationUrl(urlValue, { allowPrivateHosts = false, dnsLookup = dns.lookup } = {}) {
  let parsed;
  try {
    parsed = new URL(String(urlValue || ""));
  } catch {
    throw createBlockedRemoteHostError();
  }

  const protocol = normalizeLowerText(parsed.protocol);
  if (protocol !== "https:" && protocol !== "http:") {
    throw createBlockedRemoteHostError();
  }

  if (normalizeText(parsed.username) || normalizeText(parsed.password)) {
    throw createBlockedRemoteHostError();
  }

  if (allowPrivateHosts) {
    return parsed;
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname || LOCALHOST_HOSTNAME_SET.has(hostname) || hostname.endsWith(".local")) {
    throw createBlockedRemoteHostError();
  }

  if (net.isIP(hostname)) {
    if (isPrivateIpAddress(hostname)) {
      throw createBlockedRemoteHostError();
    }
    return parsed;
  }

  let resolved;
  try {
    resolved = await dnsLookup(hostname, { all: true, verbatim: true });
  } catch {
    throw createBlockedRemoteHostError();
  }

  if (!Array.isArray(resolved) || resolved.length < 1) {
    throw createBlockedRemoteHostError();
  }

  for (const entry of resolved) {
    const ipAddress = normalizeHostname(entry?.address);
    if (!ipAddress || isPrivateIpAddress(ipAddress)) {
      throw createBlockedRemoteHostError();
    }
  }

  return parsed;
}

async function fetchJson(urlValue, { timeoutMs = DEFAULT_FEDERATION_TIMEOUT_MS, allowPrivateHosts = false, headers = {} } = {}) {
  await assertSafeFederationUrl(urlValue, { allowPrivateHosts });

  const timeout = withTimeout(timeoutMs);
  try {
    const response = await fetch(urlValue, {
      method: "GET",
      headers: {
        accept: "application/activity+json, application/ld+json; profile=\"https://www.w3.org/ns/activitystreams\", application/json",
        ...(headers || {})
      },
      signal: timeout.signal
    });
    if (!response.ok) {
      throw new AppError(502, `Remote fetch failed (${response.status}).`, {
        details: {
          code: "SOCIAL_FEDERATION_REMOTE_FETCH_FAILED",
          status: response.status
        }
      });
    }

    const jsonPayload = await response.json();
    return jsonPayload && typeof jsonPayload === "object" ? jsonPayload : {};
  } finally {
    timeout.cleanup();
  }
}

function createLogger(observabilityService) {
  if (observabilityService && typeof observabilityService.createScopedLogger === "function") {
    return observabilityService.createScopedLogger("social.federation");
  }

  return console;
}

function mapActorForResponse(actor, { includeRaw = false } = {}) {
  if (!actor) {
    return null;
  }

  const payload = {
    id: actor.id,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    publicChatId: actor.publicChatId,
    username: actor.username,
    displayName: actor.displayName,
    summaryText: actor.summaryText,
    actorUri: actor.actorUri,
    inboxUrl: actor.inboxUrl,
    sharedInboxUrl: actor.sharedInboxUrl,
    outboxUrl: actor.outboxUrl,
    followersUrl: actor.followersUrl,
    followingUrl: actor.followingUrl,
    objectUri: actor.objectUri,
    isLocal: actor.isLocal,
    isSuspended: actor.isSuspended,
    lastFetchedAt: actor.lastFetchedAt,
    createdAt: actor.createdAt,
    updatedAt: actor.updatedAt
  };

  if (includeRaw) {
    payload.raw = actor.raw;
  }

  return payload;
}

function mapPostForResponse(post, actorsById = new Map()) {
  const author = actorsById.get(Number(post.actorId)) || null;
  return {
    id: post.id,
    workspaceId: post.workspaceId,
    actorId: post.actorId,
    objectUri: post.objectUri,
    activityUri: post.activityUri,
    inReplyToPostId: post.inReplyToPostId,
    inReplyToObjectUri: post.inReplyToObjectUri,
    visibility: post.visibility,
    contentText: post.contentText,
    contentHtml: post.contentHtml,
    language: post.language,
    isLocal: post.isLocal,
    isDeleted: post.isDeleted,
    likeCount: post.likeCount,
    announceCount: post.announceCount,
    replyCount: post.replyCount,
    publishedAt: post.publishedAt,
    editedAt: post.editedAt,
    deletedAt: post.deletedAt,
    attachments: normalizeArray(post.attachments),
    author: mapActorForResponse(author)
  };
}

function buildCollectionId({ appPublicUrl, workspaceSlug, path }) {
  const normalizedBase = String(appPublicUrl || "").trim().replace(/\/+$/, "");
  const normalizedWorkspaceSlug = normalizeText(workspaceSlug);
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  return `${normalizedBase}/ap/${normalizedWorkspaceSlug}/${normalizedPath}`;
}

function createOrderedCollection({ id, totalItems = 0, items = [] } = {}) {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id,
    type: "OrderedCollection",
    totalItems,
    orderedItems: items
  };
}

function createPublicKeyDocument({ actorUri, keyId, publicKeyPem }) {
  return {
    id: keyId,
    owner: actorUri,
    publicKeyPem
  };
}

function normalizeHostnameFromAppPublicUrl(appPublicUrl) {
  try {
    const parsed = new URL(String(appPublicUrl || ""));
    return normalizeLowerText(parsed.hostname);
  } catch {
    return "";
  }
}

function parseAcctResource(resource) {
  const normalizedResource = normalizeLowerText(resource);
  if (!normalizedResource.startsWith("acct:")) {
    return null;
  }

  const value = normalizedResource.slice("acct:".length);
  const parts = value.split("@");
  if (parts.length !== 2) {
    return null;
  }

  return {
    username: parts[0],
    domain: parts[1]
  };
}

function extractActivityObjectId(activity) {
  const normalizedActivity = activity && typeof activity === "object" ? activity : {};
  const rawObject = normalizedActivity.object;

  if (typeof rawObject === "string") {
    return normalizeText(rawObject);
  }

  if (rawObject && typeof rawObject === "object") {
    return normalizeText(rawObject.id || rawObject.object || rawObject.url);
  }

  return "";
}

function computeBackoffMs({ attemptCount, retryBaseMs, retryMaxDelayMs, jitterRatio }) {
  const attempt = Math.max(0, Number(attemptCount) || 0);
  const rawDelay = Math.min(retryMaxDelayMs, retryBaseMs * Math.pow(2, attempt));
  const jitter = Math.round(rawDelay * jitterRatio * Math.random());
  return rawDelay + jitter;
}

function buildDeliveryDedupeKey({ workspaceId, activityId, activityType, seed = "" }) {
  const normalizedSeed = normalizeText(seed) || `${normalizeLowerText(activityType) || "activity"}:${workspaceId}`;
  const normalizedActivityId = normalizeText(activityId) || `${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
  const activityHash = crypto.createHash("sha256").update(normalizedActivityId).digest("hex").slice(0, 16);
  const normalizedKey = `${normalizedSeed}:${activityHash}`
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9:_-]/g, "-");
  if (normalizedKey.length <= 255) {
    return normalizedKey;
  }

  const overflowHash = crypto.createHash("sha256").update(normalizedKey).digest("hex").slice(0, 8);
  return `${normalizedKey.slice(0, 246)}:${overflowHash}`;
}

function createService({
  socialRepository,
  chatUserSettingsRepository,
  userProfilesRepository,
  workspacesRepository,
  realtimeEventsService,
  realtimeTopics = {},
  realtimeEventTypes = {},
  appPublicUrl,
  observabilityService,
  repositoryConfig = {},
  env = {}
} = {}) {
  if (!socialRepository || typeof socialRepository !== "object") {
    throw new Error("socialRepository is required.");
  }
  if (!chatUserSettingsRepository || typeof chatUserSettingsRepository.findByUserId !== "function") {
    throw new Error("chatUserSettingsRepository.findByUserId is required.");
  }
  if (!userProfilesRepository || typeof userProfilesRepository.findById !== "function") {
    throw new Error("userProfilesRepository.findById is required.");
  }

  const logger = createLogger(observabilityService);
  const policy = resolveRuntimePolicy({ repositoryConfig, env });
  const normalizedAppPublicUrl = String(appPublicUrl || "").trim().replace(/\/+$/, "");
  const appPublicHostname = normalizeHostnameFromAppPublicUrl(normalizedAppPublicUrl);

  function assertEnabled() {
    if (!policy.enabled) {
      throw new AppError(404, "Not found.");
    }
  }

  function assertFederationEnabled() {
    if (!policy.enabled || !policy.federationEnabled) {
      throw new AppError(404, "Not found.");
    }
  }

  function publishSocialFeedUpdated({ workspace, postId = null, operation = "updated" } = {}) {
    if (!realtimeEventsService || typeof realtimeEventsService.publishWorkspaceEvent !== "function") {
      return;
    }

    try {
      realtimeEventsService.publishWorkspaceEvent({
        eventType: realtimeEventTypes.SOCIAL_FEED_UPDATED || "social.feed.updated",
        topic: realtimeTopics.SOCIAL_FEED || "social_feed",
        workspace,
        entityType: "social_post",
        entityId: postId,
        payload: {
          operation,
          postId
        }
      });
    } catch (error) {
      logger.warn?.({ err: error }, "social.realtime.feed.publish_failed");
    }
  }

  function publishSocialNotificationsUpdated({ workspace, userId = null } = {}) {
    if (!realtimeEventsService || typeof realtimeEventsService.publishWorkspaceEvent !== "function") {
      return;
    }

    try {
      realtimeEventsService.publishWorkspaceEvent({
        eventType: realtimeEventTypes.SOCIAL_NOTIFICATIONS_UPDATED || "social.notifications.updated",
        topic: realtimeTopics.SOCIAL_NOTIFICATIONS || "social_notifications",
        workspace,
        entityType: "user",
        entityId: userId,
        payload: {
          userId
        }
      });
    } catch (error) {
      logger.warn?.({ err: error }, "social.realtime.notifications.publish_failed");
    }
  }

  async function resolveWorkspaceByIdOrNull(workspaceId) {
    const normalizedWorkspaceId = toPositiveInteger(workspaceId);
    if (!normalizedWorkspaceId || typeof workspacesRepository?.findById !== "function") {
      return null;
    }

    try {
      return await workspacesRepository.findById(normalizedWorkspaceId);
    } catch {
      return null;
    }
  }

  async function resolveFederationWorkspace(
    workspace,
    { hintUsername = "", hintObjectId = "", hintActorUri = "", hintActivityId = "" } = {}
  ) {
    const directWorkspaceId = toPositiveInteger(workspace?.id);
    if (directWorkspaceId) {
      return {
        workspaceId: directWorkspaceId,
        workspace: workspace || { id: directWorkspaceId, slug: `workspace-${directWorkspaceId}` }
      };
    }

    const normalizedHintUsername = normalizeLowerText(hintUsername);
    if (normalizedHintUsername && typeof socialRepository.actors.findByUsernameAnyWorkspace === "function") {
      const actorRow = await socialRepository.actors.findByUsernameAnyWorkspace(normalizedHintUsername);
      if (actorRow?.workspaceId) {
        const actorWorkspace = await resolveWorkspaceByIdOrNull(actorRow.workspaceId);
        return {
          workspaceId: actorRow.workspaceId,
          workspace: actorWorkspace || { id: actorRow.workspaceId, slug: `workspace-${actorRow.workspaceId}` }
        };
      }
    }

    const explicitWorkspaceId = toPositiveInteger(
      env.SOCIAL_FEDERATION_DEFAULT_WORKSPACE_ID || repositoryConfig?.social?.federationDefaultWorkspaceId
    );
    if (explicitWorkspaceId) {
      const explicitWorkspace = await resolveWorkspaceByIdOrNull(explicitWorkspaceId);
      if (explicitWorkspace) {
        return {
          workspaceId: explicitWorkspaceId,
          workspace: explicitWorkspace
        };
      }
    }

    const objectUriCandidates = resolveObjectUriCandidates(hintObjectId, normalizedAppPublicUrl);
    if (objectUriCandidates.length > 0) {
      let post = null;
      if (typeof socialRepository.posts.findByObjectUriAnyWorkspace === "function") {
        for (const objectUriCandidate of objectUriCandidates) {
          post = await socialRepository.posts.findByObjectUriAnyWorkspace(objectUriCandidate);
          if (post) {
            break;
          }
        }
      }
      if (!post && typeof socialRepository.posts.findByActivityUriAnyWorkspace === "function") {
        post = await socialRepository.posts.findByActivityUriAnyWorkspace(objectUriCandidates[0]);
      }
      if (!post && typeof socialRepository.posts.findByIdAnyWorkspace === "function") {
        const numericObjectId = toPositiveInteger(objectUriCandidates[0]);
        if (numericObjectId) {
          post = await socialRepository.posts.findByIdAnyWorkspace(numericObjectId);
        }
      }
      if (post?.workspaceId) {
        const postWorkspace = await resolveWorkspaceByIdOrNull(post.workspaceId);
        return {
          workspaceId: post.workspaceId,
          workspace: postWorkspace || { id: post.workspaceId, slug: `workspace-${post.workspaceId}` }
        };
      }
    }

    const normalizedHintActivityId = normalizeText(hintActivityId);
    if (normalizedHintActivityId) {
      if (typeof socialRepository.outboxDeliveries.findByActivityIdAnyWorkspace === "function") {
        const delivery = await socialRepository.outboxDeliveries.findByActivityIdAnyWorkspace(normalizedHintActivityId);
        if (delivery?.workspaceId) {
          const deliveryWorkspace = await resolveWorkspaceByIdOrNull(delivery.workspaceId);
          return {
            workspaceId: delivery.workspaceId,
            workspace: deliveryWorkspace || { id: delivery.workspaceId, slug: `workspace-${delivery.workspaceId}` }
          };
        }
      }

      if (typeof socialRepository.posts.findByActivityUriAnyWorkspace === "function") {
        const postByActivity = await socialRepository.posts.findByActivityUriAnyWorkspace(normalizedHintActivityId);
        if (postByActivity?.workspaceId) {
          const postWorkspace = await resolveWorkspaceByIdOrNull(postByActivity.workspaceId);
          return {
            workspaceId: postByActivity.workspaceId,
            workspace: postWorkspace || { id: postByActivity.workspaceId, slug: `workspace-${postByActivity.workspaceId}` }
          };
        }
      }
    }

    const normalizedHintActorUri = normalizeText(hintActorUri);
    if (normalizedHintActorUri && typeof socialRepository.actors.findByActorUriAnyWorkspace === "function") {
      const actorRow = await socialRepository.actors.findByActorUriAnyWorkspace(normalizedHintActorUri);
      if (actorRow?.workspaceId) {
        const actorWorkspace = await resolveWorkspaceByIdOrNull(actorRow.workspaceId);
        return {
          workspaceId: actorRow.workspaceId,
          workspace: actorWorkspace || { id: actorRow.workspaceId, slug: `workspace-${actorRow.workspaceId}` }
        };
      }
    }

    if (typeof socialRepository.actors.findFirstLocal === "function") {
      const firstLocalActor = await socialRepository.actors.findFirstLocal();
      if (firstLocalActor?.workspaceId) {
        const firstWorkspace = await resolveWorkspaceByIdOrNull(firstLocalActor.workspaceId);
        return {
          workspaceId: firstLocalActor.workspaceId,
          workspace: firstWorkspace || { id: firstLocalActor.workspaceId, slug: `workspace-${firstLocalActor.workspaceId}` }
        };
      }
    }

    throw new AppError(404, "Not found.");
  }

  async function ensureLocalActor({ workspace, user }) {
    const workspaceId = resolveWorkspaceId(workspace);
    const userId = resolveActorUserId(user);

    const existingLocalActor = await socialRepository.actors.findLocalByUserId(workspaceId, userId);
    if (existingLocalActor) {
      const canonicalOutboxUrl = buildActorOutboxUrl(normalizedAppPublicUrl, existingLocalActor.username);
      if (normalizeText(existingLocalActor.outboxUrl) !== canonicalOutboxUrl) {
        return socialRepository.actors.upsert(workspaceId, {
          userId: existingLocalActor.userId,
          publicChatId: existingLocalActor.publicChatId,
          username: existingLocalActor.username,
          displayName: existingLocalActor.displayName,
          summaryText: existingLocalActor.summaryText,
          actorUri: existingLocalActor.actorUri,
          inboxUrl: existingLocalActor.inboxUrl,
          sharedInboxUrl: existingLocalActor.sharedInboxUrl,
          outboxUrl: canonicalOutboxUrl,
          followersUrl: existingLocalActor.followersUrl,
          followingUrl: existingLocalActor.followingUrl,
          objectUri: existingLocalActor.objectUri,
          isLocal: true,
          isSuspended: existingLocalActor.isSuspended,
          lastFetchedAt: existingLocalActor.lastFetchedAt,
          raw: existingLocalActor.raw || {}
        });
      }
      return existingLocalActor;
    }

    const chatSettings = await chatUserSettingsRepository.findByUserId(userId);
    const profile = await userProfilesRepository.findById(userId);

    const publicChatId = normalizeLowerText(chatSettings?.publicChatId || chatSettings?.public_chat_id);
    const username = buildActorHandle(publicChatId, userId);
    const actorUri = `${normalizedAppPublicUrl}/ap/actors/${encodeURIComponent(username)}`;

    return socialRepository.actors.upsert(workspaceId, {
      userId,
      publicChatId: username,
      username,
      displayName: String(profile?.displayName || user?.displayName || user?.email || username).trim(),
      summaryText: "",
      actorUri,
      inboxUrl: `${normalizedAppPublicUrl}/ap/actors/${encodeURIComponent(username)}/inbox`,
      sharedInboxUrl: `${normalizedAppPublicUrl}/ap/inbox`,
      outboxUrl: buildActorOutboxUrl(normalizedAppPublicUrl, username),
      followersUrl: `${normalizedAppPublicUrl}/ap/actors/${encodeURIComponent(username)}/followers`,
      followingUrl: `${normalizedAppPublicUrl}/ap/actors/${encodeURIComponent(username)}/following`,
      objectUri: actorUri,
      isLocal: true,
      raw: {
        preferredUsername: username,
        name: String(profile?.displayName || "").trim(),
        type: "Person"
      }
    });
  }

  async function ensureLocalActorKey({ workspaceId, actor }) {
    const existing = await socialRepository.actorKeys.findCurrentByActorId(workspaceId, actor.id);
    if (existing) {
      return existing;
    }

    const keyPair = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: "spki",
        format: "pem"
      },
      privateKeyEncoding: {
        type: "pkcs8",
        format: "pem"
      }
    });

    const keyId = `${actor.actorUri}#main-key`;
    const privateKeyEncrypted = encryptPrivateKey(keyPair.privateKey, policy.signingSecret);

    return socialRepository.actorKeys.upsert(workspaceId, actor.id, {
      keyId,
      publicKeyPem: keyPair.publicKey,
      privateKeyEncrypted,
      keyAlgorithm: "rsa-sha256"
    });
  }

  async function fetchRemoteActorByHandle(workspaceId, handle) {
    assertFederationEnabled();
    const parsedHandle = parseRemoteHandleParts(handle);
    if (!parsedHandle) {
      throw new AppError(400, "Validation failed.", {
        details: {
          code: "SOCIAL_VALIDATION_FAILED",
          fieldErrors: {
            handle: "Handle must be in username@domain format."
          }
        }
      });
    }

    const { username, domain } = parsedHandle;
    if (policy.moderation.defaultBlockedDomains.has(domain)) {
      throw new AppError(403, "Blocked by moderation policy.", {
        details: {
          code: "SOCIAL_MODERATION_BLOCKED"
        }
      });
    }

    const webfingerUrl = `https://${domain}/.well-known/webfinger?resource=${encodeURIComponent(`acct:${username}@${domain}`)}`;
    const webfinger = await fetchJson(webfingerUrl, {
      timeoutMs: policy.federationHttpTimeoutMs,
      allowPrivateHosts: policy.allowPrivateHosts
    });

    const links = normalizeArray(webfinger.links);
    const actorLink = links.find((entry) => {
      const rel = normalizeLowerText(entry?.rel);
      const type = normalizeLowerText(entry?.type);
      return rel === "self" && (type.includes("activity+json") || type.includes("ld+json"));
    });
    const actorUri = normalizeText(actorLink?.href);
    if (!actorUri) {
      throw new AppError(502, "Remote actor not found.", {
        details: {
          code: "SOCIAL_FEDERATION_REMOTE_ACTOR_NOT_FOUND"
        }
      });
    }

    return fetchAndCacheRemoteActor(workspaceId, actorUri);
  }

  async function fetchAndCacheRemoteActor(workspaceId, actorUri) {
    assertFederationEnabled();
    const normalizedActorUri = normalizeText(actorUri);
    if (!normalizedActorUri) {
      throw new AppError(400, "Validation failed.", {
        details: {
          code: "SOCIAL_VALIDATION_FAILED",
          fieldErrors: {
            actorUri: "Actor URI is required."
          }
        }
      });
    }

    const actorDomain = extractDomainFromActorUri(normalizedActorUri);
    if (actorDomain && policy.moderation.defaultBlockedDomains.has(actorDomain)) {
      throw new AppError(403, "Blocked by moderation policy.", {
        details: {
          code: "SOCIAL_MODERATION_BLOCKED"
        }
      });
    }

    const blockedRule = await socialRepository.moderation.findBlockingRuleForActor(workspaceId, {
      actorUri: normalizedActorUri,
      domain: actorDomain
    });
    if (blockedRule) {
      throw new AppError(403, "Blocked by moderation policy.", {
        details: {
          code: "SOCIAL_MODERATION_BLOCKED"
        }
      });
    }

    const actorDocument = await fetchJson(normalizedActorUri, {
      timeoutMs: policy.federationHttpTimeoutMs,
      allowPrivateHosts: policy.allowPrivateHosts
    });

    const inboxUrl = normalizeText(actorDocument.inbox);
    const sharedInboxUrl = normalizeText(actorDocument?.endpoints?.sharedInbox);
    const remoteUsername = buildRemoteUsername(
      actorDocument.preferredUsername || actorDocument.username,
      normalizedActorUri
    );
    const cachedActor = await socialRepository.actors.upsert(workspaceId, {
      username: remoteUsername,
      displayName: normalizeText(actorDocument.name),
      summaryText: normalizeText(actorDocument.summary),
      actorUri: normalizedActorUri,
      inboxUrl,
      sharedInboxUrl,
      outboxUrl: normalizeText(actorDocument.outbox),
      followersUrl: normalizeText(actorDocument.followers),
      followingUrl: normalizeText(actorDocument.following),
      objectUri: normalizedActorUri,
      isLocal: false,
      lastFetchedAt: new Date().toISOString(),
      raw: actorDocument
    });

    return cachedActor;
  }

  async function listFeed({ workspace, actor, query = {} }) {
    assertEnabled();
    resolveActorUserId(actor);

    const workspaceId = resolveWorkspaceId(workspace);
    const limit = Math.max(1, Math.min(policy.feedPageSizeMax, Number(query.limit || 20) || 20));
    const cursor = normalizeText(query.cursor || "");

    const posts = await socialRepository.posts.listFeed(workspaceId, { limit, cursor });
    const commentsByPostId = new Map();
    for (const post of posts) {
      const comments = await socialRepository.posts.listComments(workspaceId, post.id, {
        limit: policy.commentsPageSizeMax
      });
      commentsByPostId.set(post.id, comments);
    }

    const actorIds = Array.from(
      new Set(
        posts
          .flatMap((post) => [post.actorId, ...normalizeArray(commentsByPostId.get(post.id)).map((comment) => comment.actorId)])
          .map((value) => toPositiveInteger(value))
          .filter(Boolean)
      )
    );
    const actors = await socialRepository.actors.listByIds(workspaceId, actorIds);
    const actorsById = new Map(actors.map((entry) => [Number(entry.id), entry]));

    const items = posts.map((post) => ({
      ...mapPostForResponse(post, actorsById),
      comments: normalizeArray(commentsByPostId.get(post.id)).map((comment) => mapPostForResponse(comment, actorsById))
    }));

    const nextCursor = items.length > 0 ? String(items[items.length - 1].id) : "";
    return {
      items,
      pagination: {
        limit,
        cursor,
        nextCursor,
        hasMore: Boolean(items.length >= limit)
      }
    };
  }

  async function getPost({ workspace, actor, postId }) {
    assertEnabled();
    resolveActorUserId(actor);
    const workspaceId = resolveWorkspaceId(workspace);
    const normalizedPostId = toPositiveInteger(postId);
    if (!normalizedPostId) {
      throw new AppError(400, "Validation failed.", {
        details: {
          code: "SOCIAL_VALIDATION_FAILED",
          fieldErrors: {
            postId: "Post id must be a positive integer."
          }
        }
      });
    }

    const post = await socialRepository.posts.findById(workspaceId, normalizedPostId);
    if (!post || post.isDeleted) {
      throw new AppError(404, "Post not found.", {
        details: {
          code: "SOCIAL_POST_NOT_FOUND"
        }
      });
    }

    const comments = await socialRepository.posts.listComments(workspaceId, normalizedPostId, {
      limit: policy.commentsPageSizeMax
    });
    const actorIds = Array.from(new Set([post.actorId, ...comments.map((entry) => entry.actorId)])).filter(Boolean);
    const actors = await socialRepository.actors.listByIds(workspaceId, actorIds);
    const actorsById = new Map(actors.map((entry) => [Number(entry.id), entry]));

    return {
      post: mapPostForResponse(post, actorsById),
      comments: comments.map((entry) => mapPostForResponse(entry, actorsById))
    };
  }

  async function createPost({ workspace, actor, payload = {} }) {
    assertEnabled();
    const workspaceId = resolveWorkspaceId(workspace);
    const userId = resolveActorUserId(actor);

    const localActor = await ensureLocalActor({ workspace, user: actor });
    await ensureLocalActorKey({ workspaceId, actor: localActor });

    const contentText = normalizeLimitedText(payload.contentText || payload.text, {
      fieldName: "contentText",
      minLength: 1,
      maxLength: policy.postMaxChars
    });
    const visibility = normalizePostVisibility(payload.visibility);
    const workspaceSlug = resolveWorkspaceSlug(workspace, `workspace-${workspaceId}`);
    const seed = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const objectUri = buildObjectUri(normalizedAppPublicUrl, seed);
    const activityUri = buildActivityUri(normalizedAppPublicUrl, workspaceSlug, "create", seed);

    const post = await socialRepository.posts.create(workspaceId, {
      actorId: localActor.id,
      objectUri,
      activityUri,
      inReplyToPostId: null,
      inReplyToObjectUri: null,
      visibility,
      contentText,
      contentHtml: normalizeText(payload.contentHtml) || null,
      language: normalizeText(payload.language) || null,
      isLocal: true,
      attachments: normalizeArray(payload.attachments)
    });

    publishSocialFeedUpdated({ workspace, postId: post.id, operation: "created" });

    if (policy.federationEnabled && (visibility === "public" || visibility === "unlisted" || visibility === "followers")) {
      await enqueueFederatedCreateForFollowers({
        workspace,
        workspaceId,
        localActor,
        post,
        userId
      });
    }

    const response = await getPost({ workspace, actor, postId: post.id });
    return {
      post: response.post
    };
  }

  async function updatePost({ workspace, actor, postId, payload = {} }) {
    assertEnabled();
    const workspaceId = resolveWorkspaceId(workspace);
    const userId = resolveActorUserId(actor);
    const normalizedPostId = toPositiveInteger(postId);

    const existingPost = await socialRepository.posts.findById(workspaceId, normalizedPostId);
    if (!existingPost || existingPost.isDeleted) {
      throw new AppError(404, "Post not found.", {
        details: {
          code: "SOCIAL_POST_NOT_FOUND"
        }
      });
    }

    const localActor = await ensureLocalActor({ workspace, user: actor });
    if (existingPost.actorId !== localActor.id) {
      throw new AppError(403, "Forbidden.");
    }

    const patch = {};
    if (Object.hasOwn(payload, "contentText") || Object.hasOwn(payload, "text")) {
      patch.contentText = normalizeLimitedText(payload.contentText || payload.text, {
        fieldName: "contentText",
        minLength: 1,
        maxLength: policy.postMaxChars
      });
    }
    if (Object.hasOwn(payload, "contentHtml")) {
      patch.contentHtml = normalizeText(payload.contentHtml) || null;
    }
    if (Object.hasOwn(payload, "visibility")) {
      patch.visibility = normalizePostVisibility(payload.visibility);
    }
    if (Object.hasOwn(payload, "language")) {
      patch.language = normalizeText(payload.language) || null;
    }
    if (Object.hasOwn(payload, "attachments")) {
      patch.attachments = normalizeArray(payload.attachments);
    }
    patch.editedAt = new Date().toISOString();

    const updated = await socialRepository.posts.update(workspaceId, normalizedPostId, patch);
    publishSocialFeedUpdated({ workspace, postId: normalizedPostId, operation: "updated" });

    if (policy.federationEnabled) {
      await enqueueFederatedUpdateForFollowers({
        workspace,
        workspaceId,
        localActor,
        post: updated,
        userId
      });
    }

    const response = await getPost({ workspace, actor, postId: normalizedPostId });
    return {
      post: response.post
    };
  }

  async function deletePost({ workspace, actor, postId }) {
    assertEnabled();
    const workspaceId = resolveWorkspaceId(workspace);
    const userId = resolveActorUserId(actor);
    const normalizedPostId = toPositiveInteger(postId);
    const localActor = await ensureLocalActor({ workspace, user: actor });

    const existing = await socialRepository.posts.findById(workspaceId, normalizedPostId);
    if (!existing) {
      throw new AppError(404, "Post not found.", {
        details: {
          code: "SOCIAL_POST_NOT_FOUND"
        }
      });
    }
    if (existing.actorId !== localActor.id) {
      throw new AppError(403, "Forbidden.");
    }

    await socialRepository.posts.softDelete(workspaceId, normalizedPostId);
    publishSocialFeedUpdated({ workspace, postId: normalizedPostId, operation: "deleted" });

    if (policy.federationEnabled) {
      await enqueueFederatedDeleteForFollowers({
        workspace,
        workspaceId,
        localActor,
        post: existing,
        userId
      });
    }

    return {
      deleted: true,
      postId: normalizedPostId
    };
  }

  async function createComment({ workspace, actor, postId, payload = {} }) {
    assertEnabled();
    const workspaceId = resolveWorkspaceId(workspace);
    const userId = resolveActorUserId(actor);
    const normalizedPostId = toPositiveInteger(postId);
    const localActor = await ensureLocalActor({ workspace, user: actor });

    const parentPost = await socialRepository.posts.findById(workspaceId, normalizedPostId);
    if (!parentPost || parentPost.isDeleted) {
      throw new AppError(404, "Post not found.", {
        details: {
          code: "SOCIAL_POST_NOT_FOUND"
        }
      });
    }

    const contentText = normalizeLimitedText(payload.contentText || payload.text, {
      fieldName: "contentText",
      minLength: 1,
      maxLength: policy.commentMaxChars
    });

    const workspaceSlug = resolveWorkspaceSlug(workspace, `workspace-${workspaceId}`);
    const seed = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const objectUri = buildObjectUri(normalizedAppPublicUrl, `comment-${seed}`);
    const activityUri = buildActivityUri(normalizedAppPublicUrl, workspaceSlug, "create", `comment-${seed}`);

    const comment = await socialRepository.posts.create(workspaceId, {
      actorId: localActor.id,
      objectUri,
      activityUri,
      inReplyToPostId: normalizedPostId,
      inReplyToObjectUri: parentPost.objectUri,
      visibility: normalizePostVisibility(payload.visibility || parentPost.visibility),
      contentText,
      contentHtml: normalizeText(payload.contentHtml) || null,
      language: normalizeText(payload.language) || null,
      isLocal: true,
      attachments: normalizeArray(payload.attachments)
    });

    publishSocialFeedUpdated({ workspace, postId: normalizedPostId, operation: "comment_created" });

    const parentAuthor = await socialRepository.actors.findById(workspaceId, parentPost.actorId);
    if (parentAuthor?.userId && parentAuthor.userId !== userId) {
      await socialRepository.notifications.create(workspaceId, {
        userId: parentAuthor.userId,
        actorId: localActor.id,
        postId: normalizedPostId,
        type: "reply",
        payload: {
          commentId: comment.id,
          postId: normalizedPostId
        }
      });
      publishSocialNotificationsUpdated({ workspace, userId: parentAuthor.userId });
    }

    if (policy.federationEnabled) {
      await enqueueFederatedCreateForFollowers({
        workspace,
        workspaceId,
        localActor,
        post: comment,
        userId
      });
    }

    const actorRows = await socialRepository.actors.listByIds(workspaceId, [comment.actorId]);
    const actorsById = new Map(actorRows.map((entry) => [Number(entry.id), entry]));
    return {
      comment: mapPostForResponse(comment, actorsById)
    };
  }

  async function deleteComment({ workspace, actor, commentId }) {
    assertEnabled();
    const workspaceId = resolveWorkspaceId(workspace);
    resolveActorUserId(actor);
    const normalizedCommentId = toPositiveInteger(commentId);
    const localActor = await ensureLocalActor({ workspace, user: actor });

    const existing = await socialRepository.posts.findById(workspaceId, normalizedCommentId);
    if (!existing) {
      throw new AppError(404, "Comment not found.", {
        details: {
          code: "SOCIAL_COMMENT_NOT_FOUND"
        }
      });
    }
    if (!existing.inReplyToPostId) {
      throw new AppError(400, "Comment not found.", {
        details: {
          code: "SOCIAL_COMMENT_NOT_FOUND"
        }
      });
    }
    if (existing.actorId !== localActor.id) {
      throw new AppError(403, "Forbidden.");
    }

    await socialRepository.posts.softDelete(workspaceId, normalizedCommentId);
    publishSocialFeedUpdated({ workspace, postId: existing.inReplyToPostId, operation: "comment_deleted" });

    return {
      deleted: true,
      commentId: normalizedCommentId,
      postId: existing.inReplyToPostId
    };
  }

  async function searchActors({ workspace, actor, query = "", limit = 20 }) {
    assertEnabled();
    resolveActorUserId(actor);
    const workspaceId = resolveWorkspaceId(workspace);
    const normalizedQuery = normalizeText(query);
    const normalizedLimit = Math.max(1, Math.min(policy.actorSearchLimitMax, Number(limit) || 20));

    const results = await socialRepository.actors.search(workspaceId, {
      query: normalizedQuery,
      limit: normalizedLimit
    });

    if (policy.federationEnabled && normalizedQuery.includes("@") && results.length < normalizedLimit) {
      try {
        const remoteActor = await fetchRemoteActorByHandle(workspaceId, normalizedQuery);
        if (remoteActor) {
          const hasExisting = results.some((entry) => entry.actorUri === remoteActor.actorUri);
          if (!hasExisting) {
            results.unshift(remoteActor);
          }
        }
      } catch (error) {
        logger.warn?.({ err: error, query: normalizedQuery }, "social.remote_actor_lookup_failed");
      }
    }

    return {
      items: results.slice(0, normalizedLimit).map((entry) => mapActorForResponse(entry))
    };
  }

  async function getActorProfile({ workspace, actor, actorSelector = {} }) {
    assertEnabled();
    resolveActorUserId(actor);
    const workspaceId = resolveWorkspaceId(workspace);

    const actorId = toPositiveInteger(actorSelector.actorId || actorSelector.id);
    let targetActor = null;
    if (actorId) {
      targetActor = await socialRepository.actors.findById(workspaceId, actorId);
    }

    if (!targetActor && actorSelector.actorUri) {
      targetActor = await socialRepository.actors.findByActorUri(workspaceId, actorSelector.actorUri);
      if (!targetActor && policy.federationEnabled) {
        targetActor = await fetchAndCacheRemoteActor(workspaceId, actorSelector.actorUri);
      }
    }

    if (!targetActor && actorSelector.username) {
      targetActor = await socialRepository.actors.findByUsername(workspaceId, actorSelector.username);
    }

    if (!targetActor) {
      throw new AppError(404, "Actor not found.", {
        details: {
          code: "SOCIAL_ACTOR_NOT_FOUND"
        }
      });
    }

    const followers = await socialRepository.follows.listFollowers(workspaceId, targetActor.id, { limit: 10 });
    const following = await socialRepository.follows.listFollowing(workspaceId, targetActor.id, { limit: 10 });

    return {
      actor: mapActorForResponse(targetActor),
      counts: {
        followers: followers.length,
        following: following.length
      }
    };
  }

  async function requestFollow({ workspace, actor, payload = {} }) {
    assertEnabled();
    const workspaceId = resolveWorkspaceId(workspace);
    const currentUserId = resolveActorUserId(actor);
    const localActor = await ensureLocalActor({ workspace, user: actor });

    let targetActor = null;
    if (payload.actorId) {
      targetActor = await socialRepository.actors.findById(workspaceId, payload.actorId);
    }
    if (!targetActor && payload.actorUri) {
      targetActor = await socialRepository.actors.findByActorUri(workspaceId, payload.actorUri);
      if (!targetActor && policy.federationEnabled) {
        targetActor = await fetchAndCacheRemoteActor(workspaceId, payload.actorUri);
      }
    }
    if (!targetActor && payload.handle) {
      const normalizedHandle = normalizeLowerText(payload.handle).replace(/^@+/, "");
      if (policy.identity.treatHandleWithDomainAsRemote && normalizedHandle.includes("@")) {
        targetActor = await fetchRemoteActorByHandle(workspaceId, normalizedHandle);
      } else {
        targetActor =
          (await socialRepository.actors.findLocalByPublicChatId(workspaceId, normalizedHandle)) ||
          (await socialRepository.actors.findByUsername(workspaceId, normalizedHandle));

        if (!targetActor && policy.federationEnabled && policy.identity.allowRemoteLookupForLocalHandles) {
          targetActor = await fetchRemoteActorByHandle(workspaceId, normalizedHandle);
        }
      }
    }

    if (!targetActor) {
      throw new AppError(404, "Actor not found.", {
        details: {
          code: "SOCIAL_ACTOR_NOT_FOUND"
        }
      });
    }

    if (targetActor.id === localActor.id) {
      throw new AppError(400, "Cannot follow yourself.", {
        details: {
          code: "SOCIAL_VALIDATION_FAILED",
          fieldErrors: {
            actorId: "Cannot follow yourself."
          }
        }
      });
    }

    const followUri = buildActivityUri(
      normalizedAppPublicUrl,
      resolveWorkspaceSlug(workspace, `workspace-${workspaceId}`),
      "follow",
      `${localActor.id}-${targetActor.id}-${Date.now().toString(36)}`
    );

    const status = targetActor.isLocal ? FOLLOW_STATUS_ACCEPTED : FOLLOW_STATUS_PENDING;
    const follow = await socialRepository.follows.createOrUpdate(workspaceId, {
      followerActorId: localActor.id,
      targetActorId: targetActor.id,
      followUri,
      status,
      isLocalInitiated: true,
      acceptedAt: status === FOLLOW_STATUS_ACCEPTED ? new Date().toISOString() : null
    });

    if (targetActor.isLocal && targetActor.userId) {
      await socialRepository.notifications.create(workspaceId, {
        userId: targetActor.userId,
        actorId: localActor.id,
        type: "follow",
        payload: {
          followId: follow.id,
          actorId: localActor.id
        }
      });
      publishSocialNotificationsUpdated({ workspace, userId: targetActor.userId });
    }

    if (!targetActor.isLocal && policy.federationEnabled) {
      await enqueueOutboundActivity({
        workspace,
        workspaceId,
        actor: localActor,
        targetActor,
        activityId: followUri,
        activityType: "Follow",
        activityPayload: {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: followUri,
          type: "Follow",
          actor: localActor.actorUri,
          object: targetActor.actorUri,
          published: new Date().toISOString()
        },
        dedupeKey: `follow:${workspaceId}:${localActor.id}:${targetActor.id}`
      });
    }

    return {
      follow
    };
  }

  async function updateFollowStatus({ workspace, actor, followId, status }) {
    assertEnabled();
    const workspaceId = resolveWorkspaceId(workspace);
    const userId = resolveActorUserId(actor);
    const normalizedFollowId = toPositiveInteger(followId);

    const follow = await socialRepository.follows.findById(workspaceId, normalizedFollowId);
    if (!follow) {
      throw new AppError(404, "Follow not found.");
    }

    const actorContext = await ensureLocalActor({ workspace, user: actor });
    const actorCanManage = follow.targetActorId === actorContext.id || follow.followerActorId === actorContext.id;
    if (!actorCanManage) {
      throw new AppError(403, "Forbidden.");
    }

    const updated = await socialRepository.follows.setStatus(workspaceId, normalizedFollowId, status);

    const followerActor = await socialRepository.actors.findById(workspaceId, updated.followerActorId);
    const targetActor = await socialRepository.actors.findById(workspaceId, updated.targetActorId);

    if (policy.federationEnabled && followerActor && targetActor && (!followerActor.isLocal || !targetActor.isLocal)) {
      const activityType =
        status === FOLLOW_STATUS_ACCEPTED
          ? "Accept"
          : status === FOLLOW_STATUS_REJECTED
            ? "Reject"
            : "Undo";
      const actorForOutbound = targetActor.isLocal ? targetActor : followerActor;
      const remoteTarget = targetActor.isLocal ? followerActor : targetActor;
      const activityId = buildActivityUri(
        normalizedAppPublicUrl,
        resolveWorkspaceSlug(workspace, `workspace-${workspaceId}`),
        activityType,
        `${updated.id}-${Date.now().toString(36)}`
      );

      await enqueueOutboundActivity({
        workspace,
        workspaceId,
        actor: actorForOutbound,
        targetActor: remoteTarget,
        activityId,
        activityType,
        activityPayload: {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: activityId,
          type: activityType,
          actor: actorForOutbound.actorUri,
          object: updated.followUri,
          published: new Date().toISOString()
        },
        dedupeKey: `follow:${status}:${workspaceId}:${updated.id}`
      });
    }

    if (status === FOLLOW_STATUS_ACCEPTED && followerActor?.userId) {
      await socialRepository.notifications.create(workspaceId, {
        userId: followerActor.userId,
        actorId: targetActor?.id || null,
        type: "follow_accepted",
        payload: {
          followId: updated.id
        }
      });
      publishSocialNotificationsUpdated({ workspace, userId: followerActor.userId });
    }

    return {
      follow: updated,
      actorUserId: userId
    };
  }

  async function listNotifications({ workspace, actor, query = {} }) {
    assertEnabled();
    const workspaceId = resolveWorkspaceId(workspace);
    const userId = resolveActorUserId(actor);
    const limit = Math.max(1, Math.min(policy.notificationsPageSizeMax, Number(query.limit || 30) || 30));
    const cursor = normalizeText(query.cursor);
    const unreadOnly = Boolean(query.unreadOnly);

    const entries = await socialRepository.notifications.listByUser(
      workspaceId,
      userId,
      {
        cursor,
        limit,
        unreadOnly
      }
    );

    return {
      items: entries,
      pagination: {
        cursor,
        limit,
        nextCursor: entries.length > 0 ? String(entries[entries.length - 1].id) : "",
        hasMore: entries.length >= limit
      }
    };
  }

  async function markNotificationsRead({ workspace, actor, payload = {} }) {
    assertEnabled();
    const workspaceId = resolveWorkspaceId(workspace);
    const userId = resolveActorUserId(actor);
    const notificationIds = normalizeArray(payload.notificationIds).map((value) => toPositiveInteger(value)).filter(Boolean);

    await socialRepository.notifications.markRead(workspaceId, userId, {
      notificationIds
    });

    publishSocialNotificationsUpdated({ workspace, userId });

    return {
      updated: true,
      notificationIds
    };
  }

  async function listModerationRules({ workspace, actor, query = {} }) {
    assertEnabled();
    resolveActorUserId(actor);
    const workspaceId = resolveWorkspaceId(workspace);
    const ruleScope = normalizeLowerText(query.ruleScope || "");

    const rules = await socialRepository.moderation.listRules(workspaceId, {
      ruleScope
    });
    return {
      items: rules
    };
  }

  async function createModerationRule({ workspace, actor, payload = {} }) {
    assertEnabled();
    const workspaceId = resolveWorkspaceId(workspace);
    const userId = resolveActorUserId(actor);

    const ruleScope = normalizeLowerText(payload.ruleScope);
    if (ruleScope !== "domain" && ruleScope !== "actor") {
      throw new AppError(400, "Validation failed.", {
        details: {
          code: "SOCIAL_VALIDATION_FAILED",
          fieldErrors: {
            ruleScope: "ruleScope must be 'domain' or 'actor'."
          }
        }
      });
    }

    const decision = normalizeLowerText(payload.decision || "block");
    if (!["block", "mute", "allow"].includes(decision)) {
      throw new AppError(400, "Validation failed.", {
        details: {
          code: "SOCIAL_VALIDATION_FAILED",
          fieldErrors: {
            decision: "decision must be block, mute, or allow."
          }
        }
      });
    }

    const rule = await socialRepository.moderation.createRule(workspaceId, {
      ruleScope,
      domain: normalizeLowerText(payload.domain || "") || null,
      actorUri: normalizeText(payload.actorUri) || null,
      decision,
      reason: normalizeText(payload.reason) || null,
      createdByUserId: userId
    });

    return {
      rule
    };
  }

  async function deleteModerationRule({ workspace, actor, ruleId }) {
    assertEnabled();
    resolveActorUserId(actor);
    const workspaceId = resolveWorkspaceId(workspace);
    const normalizedRuleId = toPositiveInteger(ruleId);
    if (!normalizedRuleId) {
      throw new AppError(400, "Validation failed.", {
        details: {
          code: "SOCIAL_VALIDATION_FAILED",
          fieldErrors: {
            ruleId: "ruleId must be a positive integer."
          }
        }
      });
    }

    await socialRepository.moderation.deleteRule(workspaceId, normalizedRuleId);
    return {
      deleted: true,
      ruleId: normalizedRuleId
    };
  }

  async function enqueueOutboundActivity({
    workspaceId,
    actor,
    targetActor,
    activityId,
    activityType,
    activityPayload,
    dedupeKey
  }) {
    const targetInboxUrl = normalizeText(targetActor.sharedInboxUrl || targetActor.inboxUrl);
    if (!targetInboxUrl) {
      return null;
    }

    const resolvedDedupeKey = buildDeliveryDedupeKey({
      workspaceId,
      activityId,
      activityType,
      seed: dedupeKey
    });

    return socialRepository.outboxDeliveries.enqueue(workspaceId, {
      actorId: actor.id,
      targetActorId: targetActor.id,
      targetInboxUrl,
      activityId,
      activityType,
      payload: activityPayload,
      dedupeKey: resolvedDedupeKey,
      maxAttempts: policy.maxAttempts,
      status: "queued",
      nextAttemptAt: new Date().toISOString()
    });
  }

  async function enqueueFederatedCreateForFollowers({ workspace, workspaceId, localActor, post, userId }) {
    const followers = await socialRepository.follows.listFollowers(workspaceId, localActor.id, {
      limit: 500
    });

    const followerActorIds = Array.from(new Set(followers.map((entry) => entry.followerActorId))).filter(Boolean);
    const followerActors = await socialRepository.actors.listByIds(workspaceId, followerActorIds);

    const activityId = post.activityUri || buildActivityUri(
      normalizedAppPublicUrl,
      resolveWorkspaceSlug(workspace),
      "create",
      `post-${post.id}`
    );

    for (const targetActor of followerActors) {
      if (!targetActor || targetActor.isLocal) {
        continue;
      }

      await enqueueOutboundActivity({
        workspace,
        workspaceId,
        actor: localActor,
        targetActor,
        activityId,
        activityType: "Create",
        activityPayload: {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: activityId,
          type: "Create",
          actor: localActor.actorUri,
          object: {
            id: post.objectUri,
            type: "Note",
            attributedTo: localActor.actorUri,
            content: post.contentHtml || post.contentText,
            published: post.publishedAt,
            to: ["https://www.w3.org/ns/activitystreams#Public"],
            cc: [localActor.followersUrl]
          },
          published: post.publishedAt,
          to: ["https://www.w3.org/ns/activitystreams#Public"],
          cc: [localActor.followersUrl]
        },
        dedupeKey: `create:${workspaceId}:${post.id}:${targetActor.id}:${userId}`
      });
    }
  }

  async function enqueueFederatedUpdateForFollowers({ workspace, workspaceId, localActor, post, userId }) {
    const followers = await socialRepository.follows.listFollowers(workspaceId, localActor.id, {
      limit: 500
    });
    const followerActorIds = Array.from(new Set(followers.map((entry) => entry.followerActorId))).filter(Boolean);
    const followerActors = await socialRepository.actors.listByIds(workspaceId, followerActorIds);

    const activityId = buildActivityUri(
      normalizedAppPublicUrl,
      resolveWorkspaceSlug(workspace),
      "update",
      `post-${post.id}-${Date.now().toString(36)}`
    );

    for (const targetActor of followerActors) {
      if (!targetActor || targetActor.isLocal) {
        continue;
      }

      await enqueueOutboundActivity({
        workspace,
        workspaceId,
        actor: localActor,
        targetActor,
        activityId,
        activityType: "Update",
        activityPayload: {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: activityId,
          type: "Update",
          actor: localActor.actorUri,
          object: {
            id: post.objectUri,
            type: "Note",
            attributedTo: localActor.actorUri,
            content: post.contentHtml || post.contentText,
            updated: new Date().toISOString(),
            to: ["https://www.w3.org/ns/activitystreams#Public"],
            cc: [localActor.followersUrl]
          },
          to: ["https://www.w3.org/ns/activitystreams#Public"],
          cc: [localActor.followersUrl]
        },
        dedupeKey: `update:${workspaceId}:${post.id}:${targetActor.id}:${userId}`
      });
    }
  }

  async function enqueueFederatedDeleteForFollowers({ workspace, workspaceId, localActor, post, userId }) {
    const followers = await socialRepository.follows.listFollowers(workspaceId, localActor.id, {
      limit: 500
    });
    const followerActorIds = Array.from(new Set(followers.map((entry) => entry.followerActorId))).filter(Boolean);
    const followerActors = await socialRepository.actors.listByIds(workspaceId, followerActorIds);

    const activityId = buildActivityUri(
      normalizedAppPublicUrl,
      resolveWorkspaceSlug(workspace),
      "delete",
      `post-${post.id}-${Date.now().toString(36)}`
    );

    for (const targetActor of followerActors) {
      if (!targetActor || targetActor.isLocal) {
        continue;
      }

      await enqueueOutboundActivity({
        workspace,
        workspaceId,
        actor: localActor,
        targetActor,
        activityId,
        activityType: "Delete",
        activityPayload: {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: activityId,
          type: "Delete",
          actor: localActor.actorUri,
          object: post.objectUri,
          to: ["https://www.w3.org/ns/activitystreams#Public"],
          cc: [localActor.followersUrl]
        },
        dedupeKey: `delete:${workspaceId}:${post.id}:${targetActor.id}:${userId}`
      });
    }
  }

  async function deliverOutboxBatch({ workspaceId, limit = policy.deliveryBatchSize } = {}) {
    assertFederationEnabled();
    const normalizedWorkspaceId = toPositiveInteger(workspaceId);
    if (!normalizedWorkspaceId) {
      throw new AppError(400, "workspaceId is required.");
    }

    const pendingDeliveries = await socialRepository.outboxDeliveries.leaseReadyBatch(
      normalizedWorkspaceId,
      {
        limit,
        now: new Date()
      }
    );

    const results = [];
    for (const delivery of pendingDeliveries) {
      const attemptCount = Number(delivery.attemptCount || 0) + 1;
      try {
        await sendSignedActivityDelivery({
          workspaceId: normalizedWorkspaceId,
          delivery,
          attemptCount
        });

        await socialRepository.outboxDeliveries.markDelivered(normalizedWorkspaceId, delivery.id, {
          attemptCount,
          lastHttpStatus: 202
        });

        results.push({
          deliveryId: delivery.id,
          status: "delivered"
        });
      } catch (error) {
        const message = normalizeText(error?.message) || "delivery_failed";
        const statusCode = Number(error?.status || error?.statusCode || 0) || null;

        if (attemptCount >= Math.max(1, Number(delivery.maxAttempts || policy.maxAttempts))) {
          await socialRepository.outboxDeliveries.markDead(normalizedWorkspaceId, delivery.id, {
            attemptCount,
            lastError: message,
            lastHttpStatus: statusCode
          });
          results.push({
            deliveryId: delivery.id,
            status: "dead",
            error: message
          });
        } else {
          const delayMs = computeBackoffMs({
            attemptCount,
            retryBaseMs: policy.retryBaseMs,
            retryMaxDelayMs: policy.retryMaxDelayMs,
            jitterRatio: policy.retryJitterRatio
          });
          const nextAttemptAt = new Date(Date.now() + delayMs);
          await socialRepository.outboxDeliveries.markRetry(normalizedWorkspaceId, delivery.id, {
            attemptCount,
            lastError: message,
            lastHttpStatus: statusCode,
            nextAttemptAt
          });
          results.push({
            deliveryId: delivery.id,
            status: "retrying",
            error: message,
            nextAttemptAt: nextAttemptAt.toISOString()
          });
        }
      }
    }

    return {
      processedCount: pendingDeliveries.length,
      results
    };
  }

  async function sendSignedActivityDelivery({ workspaceId, delivery, attemptCount }) {
    const actor = await socialRepository.actors.findById(workspaceId, delivery.actorId);
    if (!actor || !actor.isLocal) {
      throw new AppError(404, "Local actor not found for delivery.");
    }

    const actorKey = await ensureLocalActorKey({ workspaceId, actor });
    const privateKeyPem = decryptPrivateKey(actorKey.privateKeyEncrypted, policy.signingSecret);
    const payload = delivery.payload && typeof delivery.payload === "object" ? delivery.payload : {};
    const body = JSON.stringify(payload);
    const bodyBuffer = Buffer.from(body, "utf8");
    const digestHeader = computeDigestHeader(bodyBuffer);
    const targetInboxUrl = normalizeText(delivery.targetInboxUrl);
    const parsedTargetUrl = await assertSafeFederationUrl(targetInboxUrl, {
      allowPrivateHosts: policy.allowPrivateHosts
    });
    const dateHeader = new Date().toUTCString();
    const signingString = [
      `(request-target): post ${parsedTargetUrl.pathname}${parsedTargetUrl.search}`,
      `host: ${parsedTargetUrl.host}`,
      `date: ${dateHeader}`,
      `digest: ${digestHeader}`
    ].join("\n");
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signingString);
    signer.end();
    const signatureValue = signer.sign(privateKeyPem).toString("base64");
    const signatureHeader = `keyId=\"${actorKey.keyId}\",algorithm=\"rsa-sha256\",headers=\"(request-target) host date digest\",signature=\"${signatureValue}\"`;

    const timeout = withTimeout(policy.federationHttpTimeoutMs);
    try {
      const response = await fetch(targetInboxUrl, {
        method: "POST",
        headers: {
          "content-type": "application/activity+json",
          accept: "application/activity+json, application/json",
          date: dateHeader,
          digest: digestHeader,
          signature: signatureHeader,
          "user-agent": `jskit-social-federation/0.1 attempt/${attemptCount}`
        },
        body,
        signal: timeout.signal
      });

      if (response.status < 200 || response.status >= 300) {
        throw new AppError(response.status, `Federation delivery failed (${response.status}).`, {
          details: {
            code: "SOCIAL_FEDERATION_DELIVERY_FAILED",
            status: response.status
          }
        });
      }
    } finally {
      timeout.cleanup();
    }
  }

  async function resolvePublicKeyForSignature({ workspaceId, keyId }) {
    const normalizedKeyId = normalizeText(keyId);
    if (!normalizedKeyId) {
      return null;
    }

    const localKey = await socialRepository.actorKeys.findByKeyId(workspaceId, normalizedKeyId);
    if (localKey && localKey.publicKeyPem) {
      return localKey.publicKeyPem;
    }

    if (!policy.federationEnabled) {
      return null;
    }

    const keyOwnerActorUri = normalizeText(normalizedKeyId.split("#")[0]);
    if (!keyOwnerActorUri) {
      return null;
    }

    const remoteActor = await fetchAndCacheRemoteActor(workspaceId, keyOwnerActorUri);
    const actorDocument = remoteActor?.raw && typeof remoteActor.raw === "object" ? remoteActor.raw : null;
    const publicKeyPem = normalizeText(
      actorDocument?.publicKey?.publicKeyPem || actorDocument?.publicKeyPem || actorDocument?.public_key_pem
    );

    return publicKeyPem || null;
  }

  async function applyAutomaticSignatureFailurePolicy({ workspaceId, actorUri }) {
    if (!policy.moderation.autoSuspendOnRepeatedSignatureFailures) {
      return;
    }

    const normalizedActorUri = normalizeText(actorUri);
    if (!normalizedActorUri || typeof socialRepository.inboxEvents.countSignatureFailures !== "function") {
      return;
    }

    const failureCount = await socialRepository.inboxEvents.countSignatureFailures(workspaceId, {
      actorUri: normalizedActorUri,
      processingError: "signature_or_digest_invalid"
    });

    if (failureCount < policy.moderation.signatureFailureSuspendThreshold) {
      return;
    }

    const actorDomain = extractDomainFromActorUri(normalizedActorUri);
    const existingRule = await socialRepository.moderation.findBlockingRuleForActor(workspaceId, {
      actorUri: normalizedActorUri,
      domain: actorDomain
    });

    if (!existingRule) {
      await socialRepository.moderation.createRule(workspaceId, {
        ruleScope: "actor",
        actorUri: normalizedActorUri,
        domain: actorDomain || null,
        decision: "block",
        reason: "automatic_signature_failures",
        createdByUserId: null
      });
    }

    const existingActor = await socialRepository.actors.findByActorUri(workspaceId, normalizedActorUri);
    if (!existingActor) {
      return;
    }

    await socialRepository.actors.upsert(workspaceId, {
      userId: existingActor.userId,
      publicChatId: existingActor.publicChatId,
      username: existingActor.username,
      displayName: existingActor.displayName,
      summaryText: existingActor.summaryText,
      actorUri: existingActor.actorUri,
      inboxUrl: existingActor.inboxUrl,
      sharedInboxUrl: existingActor.sharedInboxUrl,
      outboxUrl: existingActor.outboxUrl,
      followersUrl: existingActor.followersUrl,
      followingUrl: existingActor.followingUrl,
      objectUri: existingActor.objectUri,
      isLocal: existingActor.isLocal,
      isSuspended: true,
      lastFetchedAt: existingActor.lastFetchedAt,
      raw: existingActor.raw || {}
    });
  }

  async function processInboxActivity({ workspace, targetUsername = "", payload = {}, requestMeta = {} }) {
    assertFederationEnabled();

    const normalizedPayload = payload && typeof payload === "object" ? payload : {};
    const normalizedTargetUsername = normalizeLowerText(targetUsername);
    const activityId = normalizeText(normalizedPayload.id);
    const activityType = normalizeText(normalizedPayload.type);
    const actorUri = normalizeText(normalizedPayload.actor || normalizedPayload.attributedTo);
    const activityObjectId = extractActivityObjectId(normalizedPayload);

    if (!activityId || !activityType || !actorUri) {
      throw new AppError(400, "Invalid federation payload.", {
        details: {
          code: "SOCIAL_FEDERATION_PAYLOAD_INVALID"
        }
      });
    }

    const resolvedWorkspace = await resolveFederationWorkspace(workspace, {
      hintUsername: normalizedTargetUsername,
      hintObjectId: activityObjectId,
      hintActorUri: actorUri,
      hintActivityId: activityId
    });
    const workspaceId = resolvedWorkspace.workspaceId;
    const workspaceContext = resolvedWorkspace.workspace;

    const signatureHeader = requestMeta.signatureHeader;
    const digestHeader = requestMeta.digestHeader;
    const method = requestMeta.method || "POST";
    const pathname = requestMeta.pathname || "/ap/inbox";
    const headers = requestMeta.headers || {};
    const rawBodyBuffer = Buffer.isBuffer(requestMeta.rawBody)
      ? requestMeta.rawBody
      : Buffer.from(JSON.stringify(normalizedPayload), "utf8");

    const parsedSignature = parseSignatureHeader(signatureHeader);
    const signatureOwnerActorUri = normalizeText(parsedSignature?.keyId?.split("#")[0] || "");
    const publicKeyPem = await resolvePublicKeyForSignature({
      workspaceId,
      keyId: parsedSignature?.keyId || ""
    });

    const signatureVerification = verifySignature({
      signatureHeader,
      publicKeyPem,
      method,
      pathname,
      headers
    });
    const signatureActorMatches =
      !signatureOwnerActorUri || normalizeLowerText(signatureOwnerActorUri) === normalizeLowerText(actorUri);

    const digestValid = verifyDigestHeader({
      rawBodyBuffer,
      digestHeader
    });

    const inboxEvent = await socialRepository.inboxEvents.insertOrFetch(workspaceId, {
      activityId,
      activityType,
      actorUri,
      signatureKeyId: signatureVerification.keyId,
      signatureValid: signatureVerification.signatureValid && signatureActorMatches,
      digestValid,
      payload: normalizedPayload,
      processingStatus: "processing"
    });

    if (!inboxEvent.wasCreated) {
      const existingStatus = normalizeLowerText(inboxEvent.processingStatus);
      if (existingStatus === "processed" || existingStatus === "ignored") {
        return {
          accepted: true,
          replayed: true,
          eventId: inboxEvent.id,
          activityId,
          activityType
        };
      }

      if (existingStatus === "failed") {
        if (
          inboxEvent.processingError === "signature_or_digest_invalid" ||
          inboxEvent.processingError === "signature_actor_mismatch"
        ) {
          throw new AppError(401, "Federation signature validation failed.", {
            details: {
              code: "SOCIAL_FEDERATION_SIGNATURE_INVALID"
            }
          });
        }

        return {
          accepted: true,
          replayed: true,
          eventId: inboxEvent.id,
          activityId,
          activityType
        };
      }

      return {
        accepted: true,
        replayed: true,
        eventId: inboxEvent.id,
        activityId,
        activityType
      };
    }

    if (!signatureActorMatches) {
      await socialRepository.inboxEvents.markProcessed(workspaceId, inboxEvent.id, {
        processingStatus: "failed",
        processingError: "signature_actor_mismatch"
      });
      throw new AppError(401, "Federation signature validation failed.", {
        details: {
          code: "SOCIAL_FEDERATION_SIGNATURE_INVALID"
        }
      });
    }

    if (!signatureVerification.signatureValid || !digestValid) {
      await socialRepository.inboxEvents.markProcessed(workspaceId, inboxEvent.id, {
        processingStatus: "failed",
        processingError: "signature_or_digest_invalid"
      });
      await applyAutomaticSignatureFailurePolicy({ workspaceId, actorUri });

      throw new AppError(401, "Federation signature validation failed.", {
        details: {
          code: "SOCIAL_FEDERATION_SIGNATURE_INVALID"
        }
      });
    }

    const actorDomain = extractDomainFromActorUri(actorUri);
    if (actorDomain && policy.moderation.defaultBlockedDomains.has(actorDomain)) {
      await socialRepository.inboxEvents.markProcessed(workspaceId, inboxEvent.id, {
        processingStatus: "failed",
        processingError: "blocked_by_moderation"
      });
      throw new AppError(403, "Blocked by moderation policy.", {
        details: {
          code: "SOCIAL_MODERATION_BLOCKED"
        }
      });
    }

    const remoteActor = await fetchAndCacheRemoteActor(workspaceId, actorUri);
    const targetActor = normalizedTargetUsername
      ? await socialRepository.actors.findByUsername(workspaceId, normalizedTargetUsername)
      : null;

    const processingStatus = await processActivityType({
      workspace: workspaceContext,
      workspaceId,
      remoteActor,
      targetActor,
      activity: normalizedPayload
    });

    await socialRepository.inboxEvents.markProcessed(workspaceId, inboxEvent.id, {
      processingStatus
    });

    return {
      accepted: true,
      eventId: inboxEvent.id,
      activityId,
      activityType
    };
  }

  async function processActivityType({ workspace, workspaceId, remoteActor, targetActor, activity }) {
    const type = normalizeText(activity.type);

    if (type === "Follow") {
      await processInboundFollow({ workspace, workspaceId, remoteActor, targetActor, activity });
      return "processed";
    }

    if (type === "Accept") {
      await processInboundAccept({ workspaceId, activity });
      return "processed";
    }

    if (type === "Undo") {
      await processInboundUndo({ workspaceId, activity });
      return "processed";
    }

    if (type === "Create") {
      await processInboundCreate({ workspace, workspaceId, remoteActor, activity });
      return "processed";
    }

    if (type === "Delete") {
      await processInboundDelete({ workspace, workspaceId, remoteActor, activity });
      return "processed";
    }

    if (type === "Like" || type === "Announce") {
      await processInboundReaction({ workspace, workspaceId, remoteActor, activity });
      return "processed";
    }

    return "ignored";
  }

  async function processInboundFollow({ workspace, workspaceId, remoteActor, targetActor, activity }) {
    let resolvedTargetActor = targetActor || null;
    if (!resolvedTargetActor) {
      const rawObject = activity?.object;
      const targetActorUri =
        typeof rawObject === "string"
          ? normalizeText(rawObject)
          : rawObject && typeof rawObject === "object"
            ? normalizeText(rawObject.id || rawObject.actor)
            : "";
      if (targetActorUri) {
        resolvedTargetActor = await socialRepository.actors.findByActorUri(workspaceId, targetActorUri);
      }
    }

    if (!resolvedTargetActor || !resolvedTargetActor.isLocal) {
      return;
    }

    const followUri = normalizeText(activity.id);
    const autoAcceptRemoteFollow = !policy.moderation.requireManualApprovalForRemoteFollows;
    const followStatus = autoAcceptRemoteFollow ? FOLLOW_STATUS_ACCEPTED : FOLLOW_STATUS_PENDING;
    const follow = await socialRepository.follows.createOrUpdate(workspaceId, {
      followerActorId: remoteActor.id,
      targetActorId: resolvedTargetActor.id,
      followUri,
      status: followStatus,
      isLocalInitiated: false,
      acceptedAt: autoAcceptRemoteFollow ? new Date().toISOString() : null
    });

    if (resolvedTargetActor.userId) {
      await socialRepository.notifications.create(workspaceId, {
        userId: resolvedTargetActor.userId,
        actorId: remoteActor.id,
        type: "follow",
        payload: {
          followId: follow.id,
          actorId: remoteActor.id
        }
      });
      publishSocialNotificationsUpdated({ workspace, userId: resolvedTargetActor.userId });
    }

    if (autoAcceptRemoteFollow) {
      const acceptActivityId = buildActivityUri(
        normalizedAppPublicUrl,
        resolveWorkspaceSlug(workspace),
        "accept",
        `${follow.id}-${Date.now().toString(36)}`
      );

      await enqueueOutboundActivity({
        workspaceId,
        actor: resolvedTargetActor,
        targetActor: remoteActor,
        activityId: acceptActivityId,
        activityType: "Accept",
        activityPayload: {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: acceptActivityId,
          type: "Accept",
          actor: resolvedTargetActor.actorUri,
          object: followUri,
          published: new Date().toISOString()
        },
        dedupeKey: `inbound-follow-accept:${workspaceId}:${follow.id}`
      });
    }
  }

  async function processInboundAccept({ workspaceId, activity }) {
    const objectId = normalizeText(activity.object);
    if (!objectId) {
      return;
    }

    const match = await socialRepository.follows.findByFollowUri(workspaceId, objectId);
    if (!match) {
      return;
    }

    await socialRepository.follows.setStatus(workspaceId, match.id, FOLLOW_STATUS_ACCEPTED);
  }

  async function processInboundUndo({ workspaceId, activity }) {
    const objectId = normalizeText(activity.object);
    if (!objectId) {
      return;
    }

    const match = await socialRepository.follows.findByFollowUri(workspaceId, objectId);
    if (!match) {
      return;
    }

    await socialRepository.follows.setStatus(workspaceId, match.id, FOLLOW_STATUS_UNDONE);
  }

  async function processInboundCreate({ workspace, workspaceId, remoteActor, activity }) {
    const object = activity.object && typeof activity.object === "object" ? activity.object : null;
    if (!object) {
      return;
    }

    const objectId = normalizeText(object.id);
    const existing = await socialRepository.posts.findByObjectUri(workspaceId, objectId);
    if (existing) {
      return;
    }

    const inReplyToObjectUri = normalizeText(object.inReplyTo);
    let inReplyToPostId = null;
    if (inReplyToObjectUri) {
      const parentPost = await socialRepository.posts.findByObjectUri(workspaceId, inReplyToObjectUri);
      inReplyToPostId = parentPost?.id || null;
    }

    const created = await socialRepository.posts.create(workspaceId, {
      actorId: remoteActor.id,
      objectUri: objectId,
      activityUri: normalizeText(activity.id),
      inReplyToPostId,
      inReplyToObjectUri,
      visibility: "public",
      contentText: normalizeText(object.content || object.summary || ""),
      contentHtml: normalizeText(object.content) || null,
      language: normalizeText(object.lang) || null,
      isLocal: false,
      raw: {
        activity,
        object
      }
    });

    if (inReplyToPostId) {
      const parentPost = await socialRepository.posts.findById(workspaceId, inReplyToPostId);
      const parentActor = await socialRepository.actors.findById(workspaceId, parentPost?.actorId);
      if (parentActor?.isLocal && parentActor.userId) {
        await socialRepository.notifications.create(workspaceId, {
          userId: parentActor.userId,
          actorId: remoteActor.id,
          postId: inReplyToPostId,
          type: "reply",
          payload: {
            postId: inReplyToPostId,
            commentId: created.id,
            remote: true
          }
        });
        publishSocialNotificationsUpdated({ workspace, userId: parentActor.userId });
      }
    }

    publishSocialFeedUpdated({ workspace, postId: created.id, operation: "remote_created" });
  }

  async function processInboundDelete({ workspace, workspaceId, remoteActor, activity }) {
    const objectId = normalizeText(activity.object);
    if (!objectId) {
      return;
    }

    const post = await socialRepository.posts.findByObjectUri(workspaceId, objectId);
    if (!post) {
      return;
    }

    if (post.actorId !== remoteActor.id) {
      return;
    }

    await socialRepository.posts.softDelete(workspaceId, post.id);
    publishSocialFeedUpdated({ workspace, postId: post.id, operation: "remote_deleted" });
  }

  async function processInboundReaction({ workspace, workspaceId, remoteActor, activity }) {
    const objectId = normalizeText(activity.object);
    if (!objectId) {
      return;
    }

    const post = await socialRepository.posts.findByObjectUri(workspaceId, objectId);
    if (!post || post.isDeleted) {
      return;
    }

    const nextLikeCount = activity.type === "Like" ? post.likeCount + 1 : post.likeCount;
    const nextAnnounceCount = activity.type === "Announce" ? post.announceCount + 1 : post.announceCount;

    await socialRepository.posts.update(workspaceId, post.id, {
      raw: {
        ...(post.raw || {}),
        lastReactionActivityId: normalizeText(activity.id),
        lastReactionActorUri: remoteActor.actorUri,
        lastReactionType: activity.type
      },
      likeCount: nextLikeCount,
      announceCount: nextAnnounceCount
    });

    const postAuthor = await socialRepository.actors.findById(workspaceId, post.actorId);
    if (postAuthor?.isLocal && postAuthor.userId) {
      await socialRepository.notifications.create(workspaceId, {
        userId: postAuthor.userId,
        actorId: remoteActor.id,
        postId: post.id,
        type: activity.type === "Like" ? "like" : "announce",
        payload: {
          postId: post.id,
          activityId: normalizeText(activity.id)
        }
      });
      publishSocialNotificationsUpdated({ workspace, userId: postAuthor.userId });
    }

    publishSocialFeedUpdated({ workspace, postId: post.id, operation: "remote_reaction" });
  }

  async function getWebFinger({ resource = "", workspace }) {
    assertFederationEnabled();
    const parsedResource = parseAcctResource(resource);
    if (!parsedResource) {
      throw new AppError(400, "Invalid webfinger resource.");
    }
    if (parsedResource.domain !== appPublicHostname) {
      throw new AppError(404, "Not found.");
    }

    const resolvedWorkspace = await resolveFederationWorkspace(workspace, {
      hintUsername: parsedResource.username
    });
    const workspaceId = resolvedWorkspace.workspaceId;

    const actor = await socialRepository.actors.findByUsername(workspaceId, parsedResource.username);
    if (!actor || !actor.isLocal) {
      throw new AppError(404, "Not found.");
    }

    return {
      subject: `acct:${actor.username}@${appPublicHostname}`,
      links: [
        {
          rel: "self",
          type: "application/activity+json",
          href: actor.actorUri
        }
      ]
    };
  }

  async function getActorDocument({ workspace, username }) {
    assertFederationEnabled();
    const normalizedUsername = normalizeLowerText(username);
    if (!normalizedUsername) {
      throw new AppError(404, "Not found.");
    }

    const resolvedWorkspace = await resolveFederationWorkspace(workspace, {
      hintUsername: normalizedUsername
    });
    const workspaceId = resolvedWorkspace.workspaceId;

    const actor = await socialRepository.actors.findByUsername(workspaceId, normalizedUsername);
    if (!actor || !actor.isLocal) {
      throw new AppError(404, "Not found.");
    }

    const actorKey = await ensureLocalActorKey({ workspaceId, actor });

    return {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/v"
      ],
      id: actor.actorUri,
      type: "Person",
      preferredUsername: actor.username,
      name: actor.displayName || actor.username,
      summary: actor.summaryText || "",
      inbox: actor.inboxUrl,
      outbox: buildActorOutboxUrl(normalizedAppPublicUrl, actor.username),
      followers: actor.followersUrl,
      following: actor.followingUrl,
      publicKey: createPublicKeyDocument({
        actorUri: actor.actorUri,
        keyId: actorKey.keyId,
        publicKeyPem: actorKey.publicKeyPem
      })
    };
  }

  async function getFollowersCollection({ workspace, username }) {
    assertFederationEnabled();
    const normalizedUsername = normalizeLowerText(username);
    const resolvedWorkspace = await resolveFederationWorkspace(workspace, {
      hintUsername: normalizedUsername
    });
    const workspaceId = resolvedWorkspace.workspaceId;
    const workspaceContext = resolvedWorkspace.workspace;
    const actor = await socialRepository.actors.findByUsername(workspaceId, normalizedUsername);
    if (!actor || !actor.isLocal) {
      throw new AppError(404, "Not found.");
    }

    const followRows = await socialRepository.follows.listFollowers(workspaceId, actor.id, {
      limit: 1000
    });
    const followerIds = followRows.map((entry) => entry.followerActorId);
    const followerActors = await socialRepository.actors.listByIds(workspaceId, followerIds);

    return createOrderedCollection({
      id: actor.followersUrl || buildCollectionId({
        appPublicUrl: normalizedAppPublicUrl,
        workspaceSlug: resolveWorkspaceSlug(workspaceContext),
        path: `actors/${encodeURIComponent(actor.username)}/followers`
      }),
      totalItems: followerActors.length,
      items: followerActors.map((entry) => entry.actorUri)
    });
  }

  async function getFollowingCollection({ workspace, username }) {
    assertFederationEnabled();
    const normalizedUsername = normalizeLowerText(username);
    const resolvedWorkspace = await resolveFederationWorkspace(workspace, {
      hintUsername: normalizedUsername
    });
    const workspaceId = resolvedWorkspace.workspaceId;
    const workspaceContext = resolvedWorkspace.workspace;
    const actor = await socialRepository.actors.findByUsername(workspaceId, normalizedUsername);
    if (!actor || !actor.isLocal) {
      throw new AppError(404, "Not found.");
    }

    const followRows = await socialRepository.follows.listFollowing(workspaceId, actor.id, {
      limit: 1000
    });
    const targetIds = followRows.map((entry) => entry.targetActorId);
    const targetActors = await socialRepository.actors.listByIds(workspaceId, targetIds);

    return createOrderedCollection({
      id: actor.followingUrl || buildCollectionId({
        appPublicUrl: normalizedAppPublicUrl,
        workspaceSlug: resolveWorkspaceSlug(workspaceContext),
        path: `actors/${encodeURIComponent(actor.username)}/following`
      }),
      totalItems: targetActors.length,
      items: targetActors.map((entry) => entry.actorUri)
    });
  }

  async function getOutboxCollection({ workspace, username }) {
    assertFederationEnabled();
    const normalizedUsername = normalizeLowerText(username);
    const resolvedWorkspace = await resolveFederationWorkspace(workspace, {
      hintUsername: normalizedUsername
    });
    const workspaceId = resolvedWorkspace.workspaceId;
    const actor = await socialRepository.actors.findByUsername(workspaceId, normalizedUsername);
    if (!actor || !actor.isLocal) {
      throw new AppError(404, "Not found.");
    }

    const posts = typeof socialRepository.posts.listByActor === "function"
      ? await socialRepository.posts.listByActor(workspaceId, actor.id, { limit: 100, includeDeleted: true })
      : [];

    const orderedItems = posts
      .filter((post) => post && post.isLocal)
      .map((post) => {
        const activityId =
          normalizeText(post.activityUri) ||
          buildActivityUri(
            normalizedAppPublicUrl,
            resolveWorkspaceSlug(resolvedWorkspace.workspace, `workspace-${workspaceId}`),
            post.isDeleted ? "delete" : "create",
            `post-${post.id}`
          );
        if (post.isDeleted) {
          return {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: activityId,
            type: "Delete",
            actor: actor.actorUri,
            object: post.objectUri,
            published: post.deletedAt || post.editedAt || post.publishedAt
          };
        }

        return {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: activityId,
          type: "Create",
          actor: actor.actorUri,
          object: {
            id: post.objectUri,
            type: "Note",
            attributedTo: actor.actorUri,
            content: post.contentHtml || post.contentText,
            published: post.publishedAt,
            inReplyTo: post.inReplyToObjectUri || undefined,
            to: ["https://www.w3.org/ns/activitystreams#Public"],
            cc: actor.followersUrl ? [actor.followersUrl] : []
          },
          published: post.publishedAt,
          to: ["https://www.w3.org/ns/activitystreams#Public"],
          cc: actor.followersUrl ? [actor.followersUrl] : []
        };
      });

    return createOrderedCollection({
      id: buildActorOutboxUrl(normalizedAppPublicUrl, actor.username),
      totalItems: orderedItems.length,
      items: orderedItems
    });
  }

  async function getObjectDocument({ workspace, objectId }) {
    assertFederationEnabled();
    const rawObjectId = normalizeText(objectId);
    const normalizedObjectId = (() => {
      if (!rawObjectId) {
        return "";
      }
      try {
        return decodeURIComponent(rawObjectId);
      } catch {
        return rawObjectId;
      }
    })();
    const objectUriCandidates = resolveObjectUriCandidates(normalizedObjectId, normalizedAppPublicUrl);
    const resolvedWorkspace = await resolveFederationWorkspace(workspace, {
      hintObjectId: normalizedObjectId
    });
    const workspaceId = resolvedWorkspace.workspaceId;

    let post = null;
    for (const objectUriCandidate of objectUriCandidates) {
      post = await socialRepository.posts.findByObjectUri(workspaceId, objectUriCandidate);
      if (post) {
        break;
      }
    }
    if (!post && toPositiveInteger(normalizedObjectId)) {
      post = await socialRepository.posts.findById(workspaceId, normalizedObjectId);
    }

    if (!post || post.isDeleted) {
      throw new AppError(404, "Not found.");
    }

    const actor = await socialRepository.actors.findById(workspaceId, post.actorId);
    if (!actor) {
      throw new AppError(404, "Not found.");
    }

    return {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: post.objectUri,
      type: "Note",
      attributedTo: actor.actorUri,
      content: post.contentHtml || post.contentText,
      published: post.publishedAt,
      updated: post.editedAt || undefined,
      to: ["https://www.w3.org/ns/activitystreams#Public"],
      cc: actor.followersUrl ? [actor.followersUrl] : []
    };
  }

  return {
    policy,
    ensureLocalActor,
    listFeed,
    getPost,
    createPost,
    updatePost,
    deletePost,
    createComment,
    deleteComment,
    requestFollow,
    acceptFollow(payload) {
      return updateFollowStatus({ ...payload, status: FOLLOW_STATUS_ACCEPTED });
    },
    rejectFollow(payload) {
      return updateFollowStatus({ ...payload, status: FOLLOW_STATUS_REJECTED });
    },
    undoFollow(payload) {
      return updateFollowStatus({ ...payload, status: FOLLOW_STATUS_UNDONE });
    },
    searchActors,
    getActorProfile,
    listNotifications,
    markNotificationsRead,
    listModerationRules,
    createModerationRule,
    deleteModerationRule,
    processInboxActivity,
    deliverOutboxBatch,
    getWebFinger,
    getActorDocument,
    getFollowersCollection,
    getFollowingCollection,
    getOutboxCollection,
    getObjectDocument,
    fetchAndCacheRemoteActor,
    fetchRemoteActorByHandle
  };
}

const __testables = {
  normalizeText,
  normalizeLowerText,
  toPositiveInteger,
  normalizePostVisibility,
  parseSignatureHeader,
  buildSigningString,
  computeDigestHeader,
  verifyDigestHeader,
  verifySignature,
  parseAcctResource,
  encryptPrivateKey,
  decryptPrivateKey,
  resolveRuntimePolicy,
  assertSafeFederationUrl,
  computeBackoffMs
};

export { createService, __testables };
