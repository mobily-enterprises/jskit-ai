import { pathToFileURL } from "node:url";
import { Buffer } from "node:buffer";
import path from "node:path";
import { createNativeHistoryExport, retireNativeConversation } from "./nativeHistoryExport.js";

const OPENCODE_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;
const OPENCODE_CATALOG_LIMIT_BYTES = 32 * 1024 * 1024;
const OPENCODE_EVENT_LIMIT_BYTES = 2 * 1024 * 1024;

function text(value = "") {
  return String(value ?? "").trim();
}

function record(value = null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function openCodeServerError(message, {
  body = null,
  code = "assistant_opencode_server_request_failed",
  method = "",
  path = "",
  status = 0
} = {}) {
  const error = new Error(message);
  error.body = body;
  error.code = code;
  error.method = method;
  error.path = path;
  error.statusCode = status;
  return error;
}

async function readBoundedResponse(response, limitBytes = OPENCODE_RESPONSE_LIMIT_BYTES) {
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      length += next.value.byteLength;
      if (length > limitBytes) {
        throw openCodeServerError(
          "OpenCode returned more data than the bridge accepts.",
          { code: "assistant_opencode_response_too_large", status: response.status }
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), length).toString("utf8");
}

function parsedJson(value = "") {
  const source = String(value || "").trim();
  if (!source) {
    return null;
  }
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

function responseErrorMessage(payload = null, fallback = "OpenCode rejected the request.") {
  return text(
    payload?.message ||
    payload?.error?.message ||
    payload?.error ||
    payload?.data?.message
  ) || fallback;
}

function queryString(values = {}) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && String(value).length > 0) {
      params.set(name, String(value));
    }
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

function sessionPath(sessionId = "", suffix = "") {
  const id = encodeURIComponent(text(sessionId));
  if (!id) {
    throw new TypeError("OpenCode session requests require a session id.");
  }
  return `/api/session/${id}${suffix}`;
}

function stableSessionPath(sessionId = "", suffix = "") {
  const id = encodeURIComponent(text(sessionId));
  if (!id) {
    throw new TypeError("OpenCode session requests require a session id.");
  }
  return `/session/${id}${suffix}`;
}

function normalizedMessageRows(value = null) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : [];
  return rows.map((message) => {
    const info = message?.info;
    if (!info || typeof info !== "object" || Array.isArray(info)) {
      return message;
    }
    return {
      ...info,
      content: Array.isArray(message.parts) ? message.parts : [],
      type: text(info.role)
    };
  });
}

function providerCapabilityMedia(value = null) {
  const source = record(value);
  return Object.fromEntries([
    "audio",
    "image",
    "pdf",
    "text",
    "video"
  ].filter((name) => typeof source[name] === "boolean").map((name) => [name, source[name]]));
}

function sanitizedOpenCodeModel(model = {}, fallbackId = "") {
  const source = record(model);
  const id = text(fallbackId);
  const context = Number(source.limit?.context);
  const output = Number(source.limit?.output);
  return {
    capabilities: {
      attachment: source.capabilities?.attachment === true,
      input: providerCapabilityMedia(source.capabilities?.input),
      output: providerCapabilityMedia(source.capabilities?.output),
      reasoning: source.capabilities?.reasoning === true,
      toolcall: source.capabilities?.toolcall === true
    },
    family: text(source.family),
    id,
    limit: {
      ...(Number.isSafeInteger(context) && context > 0 ? { context } : {}),
      ...(Number.isSafeInteger(output) && output > 0 ? { output } : {})
    },
    name: text(source.name) || id,
    release_date: text(source.release_date),
    status: text(source.status),
    variants: Object.fromEntries(Object.keys(record(source.variants))
      .filter(Boolean)
      .map((variantId) => [variantId, {}]))
  };
}

function invalidOpenCodeCatalogError() {
  return openCodeServerError("OpenCode returned an invalid provider catalogue.", {
    code: "assistant_opencode_catalog_invalid",
    method: "GET",
    path: "/provider",
    status: 502
  });
}

function sanitizedOpenCodeProviderCatalog(value = null) {
  const source = record(value);
  if (!Array.isArray(source.all) || source.all.length === 0) {
    throw invalidOpenCodeCatalogError();
  }
  const all = source.all.map((provider) => {
    const candidate = record(provider);
    const id = text(candidate.id);
    const environmentNames = Array.isArray(candidate.env)
      ? candidate.env.map(text).filter(Boolean)
      : [];
    const models = record(candidate.models);
    return {
      apiKeyCompatible: environmentNames.length === 1 || [
        "amazon-bedrock",
        "google"
      ].includes(id),
      id,
      models: Object.fromEntries(Object.entries(models)
        .map(([modelId, model]) => [text(modelId), sanitizedOpenCodeModel(model, modelId)])
        .filter(([modelId, model]) => modelId && model.id)),
      name: text(candidate.name) || id
    };
  }).filter((provider) => provider.id);
  if (all.length === 0) {
    throw invalidOpenCodeCatalogError();
  }
  const defaults = record(source.default);
  return {
    all,
    default: Object.fromEntries(Object.entries(defaults)
      .map(([providerId, modelId]) => [text(providerId), text(modelId)])
      .filter(([providerId, modelId]) => providerId && modelId))
  };
}

function stablePromptBody(input = {}) {
  const model = input?.model && typeof input.model === "object" ? input.model : {};
  const modelID = text(model.modelID || model.id);
  const providerID = text(model.providerID);
  const prompt = typeof input?.prompt?.text === "string" ? input.prompt.text : "";
  const content = (input.prompt?.content || []).map(part => {
    if (part.type === "text" && typeof part.text === "string") return { type: "text", text: part.text };
    if (part.type === "image" && part.image instanceof Uint8Array && ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(part.mediaType)) {
      return { type: "file", mime: part.mediaType, url: `data:${part.mediaType};base64,${Buffer.from(part.image).toString("base64")}` };
    }
    throw new TypeError("OpenCode prompt content must contain text or authorized image bytes.");
  });
  if (!prompt.trim() && !content.length) {
    throw new TypeError("OpenCode prompt requests require text or attachment content.");
  }
  return {
    ...(text(input.agent) ? { agent: text(input.agent) } : {}),
    ...(text(input.id) ? { messageID: text(input.id) } : {}),
    ...(modelID && providerID ? { model: { modelID, providerID } } : {}),
    parts: [...(prompt ? [{ text: prompt, type: "text" }] : []), ...content, ...(input.attachments || [])
      .filter((attachment) => attachment.contentType?.startsWith("image/"))
      .map((attachment) => ({
        type: "file", mime: attachment.contentType, filename: attachment.fileName,
        url: pathToFileURL(attachment.path).href
      }))],
    ...(text(model.variant) ? { variant: text(model.variant) } : {})
  };
}

function eventSessionId(value = null) {
  const payload = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const properties = payload.properties && typeof payload.properties === "object"
    ? payload.properties
    : {};
  return text(
    payload.sessionID ||
    properties.sessionID ||
    properties.info?.sessionID ||
    properties.part?.sessionID
  );
}

function decodeOpenCodeEventData(value = "") {
  const first = parsedJson(value);
  if (typeof first !== "string") {
    return first;
  }
  return parsedJson(first) ?? first;
}

function createOpenCodeServerClient({
  allowAttachmentDirectories = false,
  baseUrl = "",
  directory = "",
  fetchImpl = globalThis.fetch,
  password = "",
  username = "opencode"
} = {}) {
  const origin = new URL(baseUrl);
  if (origin.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)) {
    throw new TypeError("OpenCode bridge clients require a loopback HTTP server.");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("OpenCode bridge clients require fetch().");
  }
  const authorization = `Basic ${Buffer.from(`${text(username) || "opencode"}:${String(password)}`).toString("base64")}`;
  const scopedDirectory = text(directory);

  function requestHeaders(accept = "application/json", body = undefined, directory = scopedDirectory) {
    return {
      accept,
      authorization,
      ...(directory ? { "x-opencode-directory": directory } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" })
    };
  }

  async function requestResponse(method = "GET", requestPath = "/", {
    body,
    directory = scopedDirectory,
    limitBytes = OPENCODE_RESPONSE_LIMIT_BYTES,
    signal
  } = {}) {
    const response = await fetchImpl(new URL(requestPath, origin), {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: requestHeaders("application/json", body, directory),
      method,
      signal
    });
    try {
      const source = response.status === 204 ? "" : await readBoundedResponse(response, limitBytes);
      if (!response.ok) {
        const payload = parsedJson(source);
        throw openCodeServerError(responseErrorMessage(payload), {
          body: payload, method, path: requestPath, status: response.status
        });
      }
      return { source, headers: response.headers };
    } finally { await response.body?.cancel().catch(() => {}); }
  }

  async function request(method, requestPath, options) {
    return parsedJson((await requestResponse(method, requestPath, options)).source);
  }

  async function requestStorageResponse(route, { signal, maxBytes = 4 * 1024 * 1024, body } = {}) {
    // The first storage request can initialize the saved directory after the
    // global health endpoint is ready. Allow the normal startup deadline.
    const deadline = AbortSignal.timeout(30_000);
    const boundedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    boundedSignal.throwIfAborted();
    const { source, headers } = await requestResponse(body === undefined ? "GET" : "PATCH", route, {
      body, signal: boundedSignal, limitBytes: maxBytes, directory: ""
    });
    boundedSignal.throwIfAborted();
    return { data: source ? JSON.parse(source) : null, headers };
  }

  async function storageInventory(route, options) {
    const { data: rows } = await requestStorageResponse(route, options);
    if (!Array.isArray(rows) || rows.length > 1000 || rows.some((row) => !/^ses_[a-zA-Z0-9]+$/u.test(row?.id))) {
      throw new Error("OpenCode returned an incomplete or invalid storage inventory.");
    }
    return rows;
  }

  function storageConversationPath(conversationId) {
    if (!/^ses_[a-zA-Z0-9]+$/u.test(conversationId)) throw new TypeError("Invalid OpenCode conversation id.");
    return `/session/${encodeURIComponent(conversationId)}`;
  }

  async function *events(sessionId = "", { onReady = null, signal } = {}) {
    const requestPath = "/event";
    const response = await fetchImpl(new URL(requestPath, origin), {
      headers: requestHeaders("text/event-stream"),
      method: "GET",
      signal
    });
    if (!response.ok || !response.body) {
      const source = await readBoundedResponse(response);
      const payload = parsedJson(source);
      throw openCodeServerError(responseErrorMessage(payload), {
        body: payload,
        method: "GET",
        path: requestPath,
        status: response.status
      });
    }
    onReady?.();
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffered = "";
    let event = { data: [], event: "message", id: "" };
    let eventBytes = 0;
    const dispatch = () => {
      if (!event.data.length) {
        event = { data: [], event: "message", id: "" };
        eventBytes = 0;
        return null;
      }
      const value = {
        data: decodeOpenCodeEventData(event.data.join("\n")),
        event: event.event,
        id: event.id
      };
      event = { data: [], event: "message", id: "" };
      eventBytes = 0;
      return value;
    };
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) {
          const finalEvent = dispatch();
          const finalSessionId = eventSessionId(finalEvent?.data);
          if (finalEvent && (!finalSessionId || finalSessionId === text(sessionId))) {
            yield finalEvent;
          }
          return;
        }
        buffered += decoder.decode(next.value, { stream: true });
        let lineEnd = buffered.indexOf("\n");
        while (lineEnd >= 0) {
          const line = buffered.slice(0, lineEnd).replace(/\r$/u, "");
          buffered = buffered.slice(lineEnd + 1);
          if (!line) {
            const value = dispatch();
            const valueSessionId = eventSessionId(value?.data);
            if (value && (!valueSessionId || valueSessionId === text(sessionId))) {
              yield value;
            }
          } else if (!line.startsWith(":")) {
            const separator = line.indexOf(":");
            const field = separator < 0 ? line : line.slice(0, separator);
            const value = separator < 0
              ? ""
              : line.slice(separator + 1).replace(/^ /u, "");
            if (field === "data") {
              eventBytes += Buffer.byteLength(value);
              if (eventBytes > OPENCODE_EVENT_LIMIT_BYTES) {
                throw openCodeServerError("An OpenCode event exceeded the bridge limit.", {
                  code: "assistant_opencode_event_too_large",
                  method: "GET",
                  path: requestPath,
                  status: response.status
                });
              }
              event.data.push(value);
            } else if (field === "event") {
              event.event = value;
            } else if (field === "id") {
              event.id = value;
            }
          }
          lineEnd = buffered.indexOf("\n");
        }
      }
    } finally {
      await reader.cancel().catch(() => null);
      reader.releaseLock();
    }
  }

  return Object.freeze({
    async allowConversationAttachments(conversationId, attachments) {
      const route = storageConversationPath(conversationId);
      const { data: session } = await requestStorageResponse(route);
      if (session?.id !== conversationId) throw new Error("OpenCode returned another conversation.");
      const permission = [...(session.permission || [])];
      const previousLength = permission.length;
      for (const attachment of attachments) {
        const pattern = path.join(path.dirname(attachment.path), "*").replaceAll("\\", "/");
        const rule = permission.findLast((item) => item.permission === "external_directory" && item.pattern === pattern);
        if (rule?.action !== "allow") permission.push({ permission: "external_directory", pattern, action: "allow" });
      }
      if (permission.length !== previousLength) {
        await requestStorageResponse(route, { body: { permission } });
      }
    },
    async listConversationChildren(conversationId, { signal } = {}) {
      const children = await storageInventory(`${storageConversationPath(conversationId)}/children`, { signal });
      if (children.some((child) => child.parentID !== conversationId)) {
        throw new Error("OpenCode returned an incomplete or invalid child inventory.");
      }
      return children;
    },
    async listConversationsForDirectory(directory, { signal } = {}) {
      if (!path.isAbsolute(directory || "")) throw new TypeError("OpenCode inventory requires an absolute native directory.");
      // Use the global persisted inventory: the project-scoped /session
      // listing loses its Git project identity once archived source is gone.
      // Request one beyond our limit to detect a truncated inventory.
      const rows = await storageInventory(`/experimental/session?${new URLSearchParams({ directory, limit: "1001" })}`, { signal });
      if (rows.some((row) => typeof row.directory !== "string")) throw new Error("OpenCode inventory has no native directory.");
      return rows.filter((row) => row.directory === directory);
    },
    async readConversationStorage(conversationId, { signal } = {}) {
      // The native storage record does not resolve a live source workspace.
      const { data } = await requestStorageResponse(storageConversationPath(conversationId), { signal });
      if (data?.id !== conversationId || !path.isAbsolute(data.directory || "")) {
        throw new Error("OpenCode returned an invalid native conversation record.");
      }
      return data;
    },
    async readConversationStoragePage(conversationId, { before = "", signal } = {}) {
      const route = `${storageConversationPath(conversationId)}/message`;
      if (typeof before !== "string" || before.length > 8192) throw new TypeError("Invalid OpenCode storage cursor.");
      const query = new URLSearchParams({ limit: "1", ...(before ? { before } : {}) });
      const { data, headers } = await requestStorageResponse(`${route}?${query}`, {
        signal, maxBytes: 64 * 1024 * 1024
      });
      const nextCursor = headers.get("x-next-cursor");
      if (!nextCursor && /rel="next"/u.test(headers.get("link") || "")) {
        throw new Error("OpenCode omitted its native history continuation cursor.");
      }
      return { data, nextCursor };
    },
    async agents({ directory = "", signal } = {}) {
      return request("GET", `/agent${queryString({ directory })}`, {
        limitBytes: OPENCODE_CATALOG_LIMIT_BYTES,
        signal
      });
    },
    async authenticateApiKey(modelProviderId = "", apiKey = "", { signal } = {}) {
      const providerId = encodeURIComponent(text(modelProviderId));
      if (!providerId || !String(apiKey)) {
        throw new TypeError("OpenCode API-key authentication requires a provider id and key.");
      }
      return request("PUT", `/auth/${providerId}`, {
        body: { key: String(apiKey), type: "api" },
        signal
      });
    },
    async createSession(input = {}, { signal } = {}) {
      return (await request("POST", "/api/session", { body: input, signal }))?.data || null;
    },
    async deleteSession(sessionId = "", { signal } = {}) {
      return request("DELETE", `/session/${encodeURIComponent(text(sessionId))}`, { signal });
    },
    async deleteMessage(sessionId, messageId, { signal } = {}) {
      if (!text(messageId)) throw new TypeError("OpenCode message deletion requires a message id.");
      return request("DELETE", stableSessionPath(sessionId, `/message/${encodeURIComponent(text(messageId))}`), { signal });
    },
    events,
    forDirectory(nextDirectory = "") {
      const normalizedDirectory = text(nextDirectory);
      if (!normalizedDirectory) {
        throw new TypeError("OpenCode project clients require a working directory.");
      }
      return createOpenCodeServerClient({
        allowAttachmentDirectories,
        baseUrl: origin.toString(),
        directory: normalizedDirectory,
        fetchImpl,
        password,
        username
      });
    },
    async health({ signal } = {}) {
      return request("GET", "/global/health", { signal });
    },
    async prepareDirectory({ signal } = {}) {
      // Global health and the v2 session routes do not initialize the directory
      // used by prompt/abort. Complete that native startup before exposing a
      // conversation whose first Stop would otherwise wait for plugin installs.
      const deadline = AbortSignal.timeout(30_000);
      const boundedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
      boundedSignal.throwIfAborted();
      const result = await request("GET", "/path", { signal: boundedSignal });
      boundedSignal.throwIfAborted();
      if (!text(result?.directory)) {
        throw openCodeServerError("OpenCode did not confirm its conversation directory is ready.", {
          code: "assistant_opencode_directory_unavailable", method: "GET", path: "/path"
        });
      }
    },
    async interrupt(sessionId = "", { signal } = {}) {
      return request("POST", stableSessionPath(sessionId, "/abort"), { signal });
    },
    async sessionStatus(sessionId = "", { signal } = {}) {
      const statuses = await request("GET", "/session/status", { signal });
      return statuses?.[text(sessionId)] || { type: "idle" };
    },
    async messages(sessionId = "", input = {}, { signal } = {}) {
      const result = await request(
        "GET",
        `${stableSessionPath(sessionId, "/message")}${queryString({ limit: input.limit })}`,
        { signal }
      );
      return { data: normalizedMessageRows(result) };
    },
    async prompt(sessionId = "", input = {}, { signal } = {}) {
      const body = stablePromptBody(input);
      if (allowAttachmentDirectories && input.attachments?.length) {
        // Native tools check the parent directory when reopening a supplied file.
        // Keep these exceptions on this conversation, alongside its existing rules.
        const session = await request("GET", stableSessionPath(sessionId), { signal });
        const permission = [...(session.permission || [])];
        const previousLength = permission.length;
        for (const attachment of input.attachments) {
          const pattern = path.join(path.dirname(attachment.path), "*").replaceAll("\\", "/");
          const rule = permission.findLast((item) => item.permission === "external_directory" && item.pattern === pattern);
          if (rule?.action !== "allow") {
            permission.push({ permission: "external_directory", pattern, action: "allow" });
          }
        }
        if (permission.length !== previousLength) {
          await request("PATCH", stableSessionPath(sessionId), { body: { permission }, signal });
        }
      }
      await request("POST", stableSessionPath(sessionId, "/prompt_async"), {
        body,
        signal
      });
      return {
        delivery: text(input.delivery),
        id: text(input.id),
        sessionID: text(sessionId)
      };
    },
    async providers({ directory = "", signal } = {}) {
      return sanitizedOpenCodeProviderCatalog(await request("GET", `/provider${queryString({ directory })}`, {
        limitBytes: OPENCODE_CATALOG_LIMIT_BYTES,
        signal
      }));
    },
    async readSession(sessionId = "", { signal } = {}) {
      return (await request("GET", sessionPath(sessionId), { signal }))?.data || null;
    },
    async removeAuthentication(modelProviderId = "", { signal } = {}) {
      return request("DELETE", `/auth/${encodeURIComponent(text(modelProviderId))}`, { signal });
    },
    async switchAgent(sessionId = "", agent = "", { signal } = {}) {
      return request("POST", sessionPath(sessionId, "/agent"), {
        body: { agent: text(agent) },
        signal
      });
    },
    async switchModel(sessionId = "", model = {}, { signal } = {}) {
      return request("POST", sessionPath(sessionId, "/model"), {
        body: { model },
        signal
      });
    }
  });
}

/** Read text snapshots without trimming the whitespace at a streaming boundary. */
function openCodeAssistantMessageText(message = {}) {
  const values = [
    message.text,
    ...(message.content || [])
      .filter((part) => part?.type === "text")
      .map((part) => part.text)
  ].filter((value) => typeof value === "string" && value.trim());
  return [...new Set(values)].join("\n\n");
}

// Native preservation uses the storage API independently of the saved worktree.
// Status still comes from the exact directory-scoped control client.
async function inspectOpenCodeConversationFamily(storageClient, controlClient, binding, { signal } = {}) {
  const queue = [binding.conversationId];
  const seen = new Set();
  const records = [];
  for (let index = 0; index < queue.length; index += 1) {
    signal?.throwIfAborted();
    const conversationId = queue[index];
    if (seen.has(conversationId) || queue.length > 1000) throw new Error("OpenCode native family is cyclic or exceeds its inventory limit.");
    seen.add(conversationId);
    let native;
    try { native = await storageClient.readConversationStorage(conversationId, { signal }); }
    catch (error) { if (error.statusCode === 404 && index === 0) return []; throw error; }
    if (native?.id !== conversationId || native?.directory !== binding.workdir ||
        (await controlClient.sessionStatus(conversationId, { signal })).type !== "idle") {
      throw new Error("OpenCode retirement requires an idle native family in the exact saved directory.");
    }
    records.push({ conversationId, workdir: native.directory,
      ...(Number.isFinite(native.time?.created) ? { createdAt: new Date(native.time.created).toISOString() } : {}),
      ...(Number.isFinite(native.time?.updated) ? { updatedAt: new Date(native.time.updated).toISOString() } : {}) });
    const children = await storageClient.listConversationChildren(conversationId, { signal });
    for (const child of children) {
      if (child.directory !== binding.workdir) throw new Error("OpenCode child directory differs from its saved owner.");
      queue.push(child.id);
    }
  }
  return records.sort((left, right) => left.conversationId.localeCompare(right.conversationId));
}

async function exportOpenCodeNativeHistory(storageClient, controlClient, id, onRecord, { signal: inputSignal } = {}) {
  const deadline = AbortSignal.timeout(300_000);
  const signal = inputSignal ? AbortSignal.any([inputSignal, deadline]) : deadline;
  const output = createNativeHistoryExport(onRecord, { signal });
  const info = await storageClient.readConversationStorage(id, { signal });
  if (info?.id !== id || (await controlClient.sessionStatus(id, { signal })).type !== "idle") {
    throw new Error("OpenCode native export requires the exact idle conversation.");
  }
  await output.emit({ type: "thread", thread: info, text: [] });
  const messageIds = new Set();
  const cursors = new Set();
  let before = "";
  let pages = 0;
  while (true) {
    signal.throwIfAborted();
    if (++pages > 20_000) throw new Error("OpenCode native export exceeded its page limit; history was not retired.");
    const response = await storageClient.readConversationStoragePage(id, { before, signal });
    if (!Array.isArray(response?.data) || response.data.length > 1 ||
        (response.nextCursor !== null && (typeof response.nextCursor !== "string" || !response.nextCursor || response.nextCursor.length > 8192)) ||
        (response.data.length === 0 && response.nextCursor !== null)) {
      throw new Error("OpenCode returned an incomplete or invalid native message page.");
    }
    for (const message of response.data) {
      const info = message?.info;
      if (!/^msg_[a-zA-Z0-9_]{1,256}$/u.test(info?.id) || info.sessionID !== id ||
          !["user", "assistant"].includes(info.role) || !Array.isArray(message.parts) || messageIds.has(info.id)) {
        throw new Error("OpenCode returned an invalid or duplicate native message.");
      }
      messageIds.add(info.id);
      const content = openCodeAssistantMessageText({ content: message.parts });
      await output.emit({ type: "message", message, text: content ? [{ role: info.role, text: content,
        branchId: id, messageId: info.id,
        ...(info.parentID ? { parentMessageId: info.parentID } : {}),
        ...(Number.isFinite(info.time?.created) ? { createdAt: new Date(info.time.created).toISOString() } : {}),
        ...(Number.isFinite(info.time?.completed) ? { completedAt: new Date(info.time.completed).toISOString() } : {}),
        ...(info.modelID || info.model?.modelID ? { modelId: info.modelID || info.model.modelID } : {}),
        ...(info.providerID || info.model?.providerID ? { modelProviderId: info.providerID || info.model.providerID } : {}),
        ...(info.agent ? { agent: info.agent } : {}) }] : [] });
    }
    if (response.nextCursor === null) break;
    if (cursors.has(response.nextCursor)) throw new Error("OpenCode repeated a native history cursor.");
    cursors.add(response.nextCursor);
    before = response.nextCursor;
  }
  return output.complete();
}

/** Retire the exact native family after the host's durable preservation. */
async function retireOpenCodeConversationHistory(storageClient, controlClient, binding, options = {}) {
  const inspect = () => inspectOpenCodeConversationFamily(storageClient, controlClient, binding, { signal: options.signal });
  return retireNativeConversation({ binding, inspect, beforeDelete: options.beforeDelete,
    readConversation: async (id) => ({ info: await storageClient.readConversationStorage(id), messages: (await controlClient.messages(id)).data }),
    exportConversation: (id, onRecord) => exportOpenCodeNativeHistory(storageClient, controlClient, id, onRecord, { signal: options.signal }),
    remove: () => controlClient.deleteSession(binding.conversationId) });
}

export {
  retireOpenCodeConversationHistory,
  openCodeAssistantMessageText,
  OPENCODE_RESPONSE_LIMIT_BYTES,
  createOpenCodeServerClient,
  readBoundedResponse
};
