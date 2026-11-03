import crypto from "node:crypto";
import path from "node:path";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeNullableText } from "./normalize.js";

const CODEX_HELPER_THREAD_LEDGER_SCHEMA_VERSION = 1;
const CODEX_HELPER_THREAD_LIFECYCLES = Object.freeze({
  ACTIVE: "active",
  CLEANUP_REQUIRED: "cleanup_required",
  READY: "ready",
  STARTING_TURN: "starting_turn"
});
const CODEX_HELPER_THREAD_LIFECYCLE_VALUES = new Set(
  Object.values(CODEX_HELPER_THREAD_LIFECYCLES)
);
const RECORD_KEYS = Object.freeze([
  "createdAt",
  "executionProfile",
  "identity",
  "lifecycle",
  "ownershipId",
  "projectContextRoot",
  "projectRuntimeRoot",
  "revision",
  "schemaVersion",
  "sessionId",
  "threadId",
  "turnId",
  "updatedAt",
  "workdir"
]);
const IDENTITY_KEYS = Object.freeze([
  "providerId",
  "providerKeyFingerprint",
  "runtime",
  "server",
  "transportId"
]);
const RUNTIME_IDENTITY_KEYS = Object.freeze([
  "accountIdentitySignature",
  "authStateSignature",
  "endpoint",
  "executionMode",
  "executionContextHash",
  "provider",
  "runtimeDir",
  "runtimesHash",
  "terminalEnvHash",
  "toolHomeSource",
  "transport"
]);
const SERVER_IDENTITY_KEYS = Object.freeze([
  "userAgent"
]);

/**
 * The helper thread ownership record: its exact shape, its identity and the validation every stored record passes.
 * @param {object} options
 * @param {(profile: unknown) => object} options.executionProfile The application's execution-profile codec.
 * @param {string} options.errorPrefix
 */
function createCodexHelperThreadRecordSchema({ executionProfile, errorPrefix }) {
  function ledgerError(message = "", code = `${errorPrefix}ledger_invalid`) {
    const error = new Error(normalizeNullableText(message) || "Codex helper ownership record is invalid.");
    error.code = code;
    error.retryable = true;
    return error;
  }

  function assertExactKeys(value, expectedKeys, label) {
    if (!isRecord(value)) {
      throw ledgerError(`${label} must be an object.`);
    }
    const actual = Object.keys(value).sort();
    const expected = [...expectedKeys].sort();
    if (
      actual.length !== expected.length ||
      actual.some((key, index) => key !== expected[index])
    ) {
      throw ledgerError(`${label} has an unsupported shape.`);
    }
  }

  function requiredText(value, label, maxLength = 4096) {
    const normalized = normalizeNullableText(value);
    if (!normalized) {
      throw ledgerError(`${label} is required.`);
    }
    if (normalized.length > maxLength) {
      throw ledgerError(`${label} exceeds ${maxLength} characters.`);
    }
    return normalized;
  }

  function requiredSha256Signature(value, label) {
    const signature = requiredText(value, label, 71);
    if (!/^sha256:[a-f0-9]{64}$/u.test(signature)) {
      throw ledgerError(`${label} must be a SHA-256 signature.`);
    }
    return signature;
  }

  function requiredVersionedStateSignature(value, label) {
    const signature = requiredText(value, label, 32);
    if (!/^v[1-9][0-9]*:[a-f0-9]{24}$/u.test(signature)) {
      throw ledgerError(`${label} must be a versioned state signature.`);
    }
    return signature;
  }

  function requiredStableHash(value, label) {
    const hash = requiredText(value, label, 12);
    if (!/^[a-f0-9]{12}$/u.test(hash)) {
      throw ledgerError(`${label} must be a stable hash.`);
    }
    return hash;
  }

  function optionalText(value, label = "value", maxLength = 4096) {
    const normalized = normalizeNullableText(value);
    if (normalized.length > maxLength) {
      throw ledgerError(`${label} exceeds ${maxLength} characters.`);
    }
    return normalized;
  }

  function absolutePath(value, label) {
    const normalized = requiredText(value, label, 8192);
    if (!path.isAbsolute(normalized) || path.normalize(normalized) !== normalized) {
      throw ledgerError(`${label} must be a normalized absolute path.`);
    }
    return normalized;
  }

  function optionalAbsolutePath(value, label) {
    const normalized = optionalText(value, label, 8192);
    if (normalized && (!path.isAbsolute(normalized) || path.normalize(normalized) !== normalized)) {
      throw ledgerError(`${label} must be a normalized absolute path when present.`);
    }
    return normalized;
  }

  function timestamp(value, label) {
    const normalized = requiredText(value, label);
    const parsed = Date.parse(normalized);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== normalized) {
      throw ledgerError(`${label} must be an ISO timestamp.`);
    }
    return normalized;
  }

  function positiveInteger(value, label) {
    const normalized = Number(value);
    if (!Number.isSafeInteger(normalized) || normalized < 1) {
      throw ledgerError(`${label} must be a positive integer.`);
    }
    return normalized;
  }

  function strictIdentity(value) {
    assertExactKeys(value, IDENTITY_KEYS, "identity");
    assertExactKeys(value.runtime, RUNTIME_IDENTITY_KEYS, "identity.runtime");
    assertExactKeys(value.server, SERVER_IDENTITY_KEYS, "identity.server");
    const runtime = value.runtime;
    const providerId = requiredText(value.providerId, "identity.providerId", 64);
    const executionMode = requiredText(
      runtime.executionMode,
      "identity.runtime.executionMode",
      64
    );
    const provider = requiredText(runtime.provider, "identity.runtime.provider");
    const toolHomeSource = optionalAbsolutePath(
      runtime.toolHomeSource,
      "identity.runtime.toolHomeSource"
    );
    const transportId = requiredText(value.transportId, "identity.transportId", 64);
    const transport = requiredText(runtime.transport, "identity.runtime.transport", 64);
    const endpoint = requiredText(runtime.endpoint, "identity.runtime.endpoint", 8192);
    const endpointPath = endpoint.startsWith("unix://") ? endpoint.slice("unix://".length) : "";
    if (
      providerId !== "codex" ||
      !["helper", "interactive"].includes(executionMode) ||
      provider !== "codex_app_server" ||
      transport !== "unix" ||
      !endpointPath ||
      !path.isAbsolute(endpointPath) ||
      path.normalize(endpointPath) !== endpointPath ||
      transportId !== "codex_app_server"
    ) {
      throw ledgerError(
        "Codex helper ownership identity must use the managed Codex app-server."
      );
    }
    return Object.freeze({
      providerId,
      providerKeyFingerprint: requiredSha256Signature(
        value.providerKeyFingerprint,
        "identity.providerKeyFingerprint"
      ),
      runtime: Object.freeze({
        accountIdentitySignature: requiredSha256Signature(
          runtime.accountIdentitySignature,
          "identity.runtime.accountIdentitySignature"
        ),
        authStateSignature: requiredVersionedStateSignature(
          runtime.authStateSignature,
          "identity.runtime.authStateSignature"
        ),
        endpoint,
        executionMode,
        executionContextHash: requiredStableHash(
          runtime.executionContextHash,
          "identity.runtime.executionContextHash"
        ),
        provider,
        runtimeDir: absolutePath(runtime.runtimeDir, "identity.runtime.runtimeDir"),
        runtimesHash: requiredStableHash(
          runtime.runtimesHash,
          "identity.runtime.runtimesHash"
        ),
        terminalEnvHash: requiredStableHash(
          runtime.terminalEnvHash,
          "identity.runtime.terminalEnvHash"
        ),
        toolHomeSource,
        transport
      }),
      server: Object.freeze({
        userAgent: requiredText(value.server.userAgent, "identity.server.userAgent", 512)
      }),
      transportId
    });
  }

  function codexHelperThreadRecordId({
    projectRuntimeRoot = "",
    sessionId = "",
    threadId = ""
  } = {}) {
    return crypto.createHash("sha256").update([
      absolutePath(projectRuntimeRoot, "projectRuntimeRoot"),
      requiredText(sessionId, "sessionId", 256),
      requiredText(threadId, "threadId", 256)
    ].join("\0")).digest("hex");
  }

  function defineCodexHelperThreadRecord(value = {}) {
    assertExactKeys(value, RECORD_KEYS, "Codex helper ownership record");
    if (Number(value.schemaVersion) !== CODEX_HELPER_THREAD_LEDGER_SCHEMA_VERSION) {
      throw ledgerError(
        `Unsupported Codex helper ownership schema: ${String(value.schemaVersion ?? "missing")}.`
      );
    }
    const lifecycle = requiredText(value.lifecycle, "lifecycle");
    if (!CODEX_HELPER_THREAD_LIFECYCLE_VALUES.has(lifecycle)) {
      throw ledgerError(`Unsupported Codex helper ownership lifecycle: ${lifecycle}.`);
    }
    const turnId = optionalText(value.turnId);
    if (lifecycle === CODEX_HELPER_THREAD_LIFECYCLES.ACTIVE && !turnId) {
      throw ledgerError("An active Codex helper ownership record requires turnId.");
    }
    if (lifecycle === CODEX_HELPER_THREAD_LIFECYCLES.READY && turnId) {
      throw ledgerError(`${lifecycle} Codex helper ownership cannot retain turnId.`);
    }
    const createdAt = timestamp(value.createdAt, "createdAt");
    const updatedAt = timestamp(value.updatedAt, "updatedAt");
    if (Date.parse(updatedAt) < Date.parse(createdAt)) {
      throw ledgerError("updatedAt cannot precede createdAt.");
    }
    return Object.freeze({
      createdAt,
      executionProfile: executionProfile(value.executionProfile),
      identity: strictIdentity(value.identity),
      lifecycle,
      ownershipId: requiredText(value.ownershipId, "ownershipId", 128),
      projectContextRoot: absolutePath(value.projectContextRoot, "projectContextRoot"),
      projectRuntimeRoot: absolutePath(value.projectRuntimeRoot, "projectRuntimeRoot"),
      revision: positiveInteger(value.revision, "revision"),
      schemaVersion: CODEX_HELPER_THREAD_LEDGER_SCHEMA_VERSION,
      sessionId: requiredText(value.sessionId, "sessionId", 256),
      threadId: requiredText(value.threadId, "threadId", 256),
      turnId: optionalText(turnId, "turnId", 256),
      updatedAt,
      workdir: absolutePath(value.workdir, "workdir")
    });
  }

  return Object.freeze({
    ledgerError,
    assertExactKeys,
    requiredText,
    absolutePath,
    timestamp,
    positiveInteger,
    codexHelperThreadRecordId,
    defineCodexHelperThreadRecord
  });
}

export {
  CODEX_HELPER_THREAD_LEDGER_SCHEMA_VERSION,
  CODEX_HELPER_THREAD_LIFECYCLES,
  createCodexHelperThreadRecordSchema
};
