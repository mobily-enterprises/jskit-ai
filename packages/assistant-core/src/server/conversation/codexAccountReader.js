import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeNullableText } from "./normalize.js";

const CODEX_APP_SERVER_SELECTED_AUTH_MAX_BYTES = 1024 * 1024;
const CODEX_APP_SERVER_CHATGPT_ACCESS_TOKEN_MAX_LENGTH = 256 * 1024;
export const CODEX_APP_SERVER_ACCOUNT_ID_MAX_LENGTH = 512;
const CODEX_APP_SERVER_PLAN_TYPE_MAX_LENGTH = 128;
const CODEX_APP_SERVER_API_KEY_MAX_LENGTH = 16 * 1024;

/** Native account records and secret-change detection. Hosts select the credential home. */
export function createCodexAccountReader({
  errorPrefix = "",
  identityNamespace = "codex-account-v1",
  secretNamespace = "codex-auth-secret-v1"
} = {}) {
  function codexAppServerHelperAuthError(code = "", message = "") {
    const error = new Error(
      normalizeNullableText(message) || "Codex helper authentication is unavailable. Reconnect Codex and retry."
    );
    error.code = normalizeNullableText(code) || `${errorPrefix}codex_helper_auth_unavailable`;
    return error;
  }

  function boundedCodexAuthText(value, {
    label = "Codex authentication value",
    maxLength = 0
  } = {}) {
    if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
      throw codexAppServerHelperAuthError(
        `${errorPrefix}codex_helper_auth_invalid`,
        `${label} is missing or invalid. Reconnect Codex and retry.`
      );
    }
    return value;
  }

  function codexAccountIdentitySignature(authMode = "", identity = "") {
    return `sha256:${createHash("sha256")
      .update(`${identityNamespace}\0`, "utf8")
      .update(normalizeNullableText(authMode), "utf8")
      .update("\0", "utf8")
      .update(String(identity || ""), "utf8")
      .digest("hex")}`;
  }

  function codexAuthSecretSignature(secret = "") {
    return createHash("sha256")
      .update(`${secretNamespace}\0`, "utf8")
      .update(String(secret || ""), "utf8")
      .digest("hex");
  }

  async function readBoundedCodexAuthJson(filePath = "") {
    let handle = null;
    try {
      handle = await open(filePath, "r");
      const fileStat = await handle.stat();
      if (!fileStat.isFile() || fileStat.size > CODEX_APP_SERVER_SELECTED_AUTH_MAX_BYTES) {
        throw codexAppServerHelperAuthError(
          `${errorPrefix}codex_helper_auth_invalid`,
          "The selected Codex authentication record is invalid. Reconnect Codex and retry."
        );
      }
      const buffer = Buffer.alloc(CODEX_APP_SERVER_SELECTED_AUTH_MAX_BYTES + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
        if (bytesRead === 0) {
          break;
        }
        offset += bytesRead;
      }
      if (offset > CODEX_APP_SERVER_SELECTED_AUTH_MAX_BYTES) {
        throw codexAppServerHelperAuthError(
          `${errorPrefix}codex_helper_auth_invalid`,
          "The selected Codex authentication record is too large. Reconnect Codex and retry."
        );
      }
      const parsed = JSON.parse(buffer.subarray(0, offset).toString("utf8"));
      if (!isRecord(parsed)) {
        throw new Error("invalid authentication record");
      }
      return parsed;
    } catch (error) {
      // readable-check: allow optional-call - data: a caught value whose code may be absent or not a string
      if (error?.code?.startsWith?.(`${errorPrefix}codex_helper_auth_`)) {
        throw error;
      }
      throw codexAppServerHelperAuthError(
        `${errorPrefix}codex_helper_auth_unavailable`,
        "The selected Codex authentication record could not be read. Reconnect Codex and retry."
      );
    } finally {
      await handle?.close().catch(() => null);
    }
  }

  async function readCodexSelectedAccountAuth(options = {}) {
    const toolHomeSource = normalizeNullableText(options.toolHomeSource);
    if (!toolHomeSource || !path.isAbsolute(toolHomeSource)) {
      throw codexAppServerHelperAuthError(
        `${errorPrefix}codex_helper_auth_unavailable`,
        "The selected Codex account is unavailable. Reconnect Codex and retry."
      );
    }
    const auth = await readBoundedCodexAuthJson(path.join(toolHomeSource, ".codex", "auth.json"));
    const storedMode = normalizeNullableText(auth.auth_mode).toLowerCase();
    if (storedMode === "chatgpt") {
      const tokens = isRecord(auth.tokens) ? auth.tokens : {};
      const accountId = boundedCodexAuthText(tokens.account_id, {
        label: "Codex account identity",
        maxLength: CODEX_APP_SERVER_ACCOUNT_ID_MAX_LENGTH
      });
      const accessToken = boundedCodexAuthText(tokens.access_token, {
        label: "Codex access token",
        maxLength: CODEX_APP_SERVER_CHATGPT_ACCESS_TOKEN_MAX_LENGTH
      });
      const planTypeValue = tokens.chatgpt_plan_type ?? tokens.plan_type;
      const planType = planTypeValue === undefined || planTypeValue === null || planTypeValue === ""
        ? ""
        : boundedCodexAuthText(planTypeValue, {
            label: "Codex plan type",
            maxLength: CODEX_APP_SERVER_PLAN_TYPE_MAX_LENGTH
          });
      return Object.freeze({
        accessToken,
        accountId,
        authMode: "chatgpt",
        identitySignature: codexAccountIdentitySignature("chatgpt", accountId),
        planType,
        secretSignature: codexAuthSecretSignature(accessToken)
      });
    }
    if (["apikey", "api_key"].includes(storedMode)) {
      const apiKey = boundedCodexAuthText(auth.OPENAI_API_KEY, {
        label: "Codex API key",
        maxLength: CODEX_APP_SERVER_API_KEY_MAX_LENGTH
      });
      return Object.freeze({
        apiKey,
        authMode: "apiKey",
        identitySignature: codexAccountIdentitySignature("apiKey", apiKey),
        secretSignature: codexAuthSecretSignature(apiKey)
      });
    }
    throw codexAppServerHelperAuthError(
      `${errorPrefix}codex_helper_auth_invalid`,
      "The selected Codex authentication mode is unsupported. Reconnect Codex and retry."
    );
  }

  return Object.freeze({
    error: codexAppServerHelperAuthError,
    identitySignature: codexAccountIdentitySignature,
    readRecord: readBoundedCodexAuthJson,
    readSelected: readCodexSelectedAccountAuth
  });
}

const CODEX_AUTH_INVALIDATED_PATTERN =
  /\b(?:token_invalidated|refresh_token_invalidated)\b|authentication token has been invalidated|HTTP error:\s*401 Unauthorized|401 Unauthorized/iu;

export function codexAuthOutputRequiresReconnect(output = "") {
  return CODEX_AUTH_INVALIDATED_PATTERN.test(String(output || ""));
}