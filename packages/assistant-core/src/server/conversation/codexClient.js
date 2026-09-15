import { createConnection } from "node:net";
import WebSocket from "ws";
import { normalizeText as normalizeAgentText } from "./normalize.js";
const CODEX_APP_SERVER_REQUEST_TIMEOUT_MS = 60_000;
function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function socketPathFromCodexAppServerEndpoint(endpoint = "") {
  const normalizedEndpoint = normalizeAgentText(endpoint);
  if (!normalizedEndpoint.startsWith("unix://")) {
    return "";
  }
  return normalizedEndpoint.slice("unix://".length);
}

function codexAppServerRequestAbortedError(method = "") {
  const error = new Error(`Codex app-server request was cancelled: ${normalizeAgentText(method)}`);
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  error.method = normalizeAgentText(method);
  return error;
}

function addSocketListener(socket, eventName, handler) {
  if (typeof socket.addEventListener === "function") {
    socket.addEventListener(eventName, handler);
    return () => socket.removeEventListener?.(eventName, handler);
  }
  if (typeof socket.on === "function") {
    socket.on(eventName, handler);
    return () => socket.off?.(eventName, handler) || socket.removeListener?.(eventName, handler);
  }
  throw new Error("Unsupported WebSocket implementation.");
}

function socketMessageText(event, maxBytes = Number.POSITIVE_INFINITY) {
  const data = event?.data ?? event;
  if (typeof data === "string") {
    return Buffer.byteLength(data, "utf8") <= maxBytes ? data : null;
  }
  if (data instanceof Buffer) {
    return data.byteLength <= maxBytes ? data.toString("utf8") : null;
  }
  const text = String(data || "");
  return Buffer.byteLength(text, "utf8") <= maxBytes ? text : null;
}

class CodexAppServerJsonRpcClient {
  constructor({
    endpoint = "",
    maxMessageBytes = Number.POSITIVE_INFINITY,
    requestTimeoutMs = CODEX_APP_SERVER_REQUEST_TIMEOUT_MS,
    WebSocketImpl = WebSocket
  } = {}) {
    this.endpoint = normalizeAgentText(endpoint);
    this.maxMessageBytes = Number.isSafeInteger(maxMessageBytes) && maxMessageBytes > 0
      ? maxMessageBytes
      : Number.POSITIVE_INFINITY;
    this.requestTimeoutMs = normalizePositiveInteger(requestTimeoutMs, CODEX_APP_SERVER_REQUEST_TIMEOUT_MS);
    this.WebSocketImpl = WebSocketImpl;
    this.nextRequestId = 1;
    this.notificationSubscribers = new Set();
    this.pendingRequests = new Map();
    this.requestHandler = null;
    this.connected = false;
    this.socket = null;
  }

  isOpen() {
    return Boolean(this.socket && (this.connected || this.socket.readyState === 1));
  }

  async connect() {
    if (!this.endpoint) {
      throw new Error("Codex app-server endpoint is required.");
    }
    if (typeof this.WebSocketImpl !== "function") {
      throw new Error("A WebSocket implementation is required for Codex app-server.");
    }
    if (this.isOpen()) {
      return this;
    }
    this.close();
    const unixSocketPath = socketPathFromCodexAppServerEndpoint(this.endpoint);
    const socketOptions = unixSocketPath
      ? {
          createConnection: () => createConnection(unixSocketPath),
          ...(Number.isFinite(this.maxMessageBytes) ? { maxPayload: this.maxMessageBytes } : {}),
          perMessageDeflate: false
        }
      : {
          ...(Number.isFinite(this.maxMessageBytes) ? { maxPayload: this.maxMessageBytes } : {}),
          perMessageDeflate: false
        };
    const socket = new this.WebSocketImpl(unixSocketPath ? "ws://localhost/" : this.endpoint, socketOptions);
    this.socket = socket;
    await new Promise((resolve, reject) => {
      const cleanup = [];
      const settle = (callback, value) => {
        for (const dispose of cleanup) {
          dispose?.();
        }
        callback(value);
      };
      cleanup.push(addSocketListener(socket, "open", () => {
        if (this.socket === socket) {
          this.connected = true;
        }
        settle(resolve);
      }));
      cleanup.push(addSocketListener(socket, "error", (error) => {
        if (this.socket === socket) {
          this.connected = false;
          this.socket = null;
        }
        settle(reject, error?.error || error);
      }));
    });
    addSocketListener(socket, "message", (event) => this.handleMessage(event));
    addSocketListener(socket, "close", () => {
      if (this.socket === socket) {
        this.connected = false;
        this.socket = null;
      }
      this.rejectPendingRequests(new Error("Codex app-server connection closed."));
    });
    return this;
  }

  async initialize({
    capabilities = {
      experimentalApi: true,
      requestAttestation: false
    },
    clientInfo = {
      name: "jskit-assistant",
      title: "Assistant",
      version: "0.1.0"
    }
  } = {}) {
    const result = await this.request("initialize", {
      capabilities,
      clientInfo
    });
    this.notify("initialized");
    return result;
  }

  subscribe(callback) {
    if (typeof callback !== "function") {
      return () => null;
    }
    this.notificationSubscribers.add(callback);
    return () => {
      this.notificationSubscribers.delete(callback);
    };
  }

  setRequestHandler(callback) {
    this.requestHandler = typeof callback === "function" ? callback : null;
  }

  notify(method, params) {
    this.send({
      method,
      ...(params === undefined ? {} : { params })
    });
  }

  request(method, params = {}, {
    signal = null
  } = {}) {
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(codexAppServerRequestAbortedError(method));
        return;
      }
      const removeAbortListener = () => {
        signal?.removeEventListener?.("abort", abort);
      };
      const abort = () => {
        const pending = this.pendingRequests.get(id);
        if (!pending) {
          return;
        }
        clearTimeout(pending.timeout);
        removeAbortListener();
        this.pendingRequests.delete(id);
        reject(codexAppServerRequestAbortedError(method));
      };
      const timeout = setTimeout(() => {
        removeAbortListener();
        this.pendingRequests.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, this.requestTimeoutMs);
      this.pendingRequests.set(id, {
        method,
        removeAbortListener,
        reject,
        resolve,
        timeout
      });
      signal?.addEventListener?.("abort", abort, { once: true });
      try {
        this.send({
          id,
          method,
          params
        });
      } catch (error) {
        clearTimeout(timeout);
        removeAbortListener();
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  send(payload) {
    if (!this.isOpen() || typeof this.socket.send !== "function") {
      throw new Error("Codex app-server connection is not open.");
    }
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized, "utf8") > this.maxMessageBytes) {
      const error = new Error("Codex app-server message exceeded the configured transport limit.");
      error.code = "assistant_codex_app_server_message_too_large";
      throw error;
    }
    this.socket.send(serialized);
  }

  handleMessage(event) {
    let message = null;
    try {
      const text = socketMessageText(event, this.maxMessageBytes);
      if (text === null) {
        const error = new Error("Codex app-server message exceeded the configured transport limit.");
        error.code = "assistant_codex_app_server_message_too_large";
        this.rejectPendingRequests(error);
        this.close();
        return;
      }
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (Object.hasOwn(message, "id") && message.method) {
      void this.handleServerRequest(message);
      return;
    }
    if (Object.hasOwn(message, "id")) {
      const pending = this.pendingRequests.get(message.id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
      pending.removeAbortListener?.();
      this.pendingRequests.delete(message.id);
      if (message.error) {
        const error = new Error(message.error.message || `Codex app-server request failed: ${pending.method}`);
        error.code = message.error.code;
        error.data = message.error.data;
        error.method = pending.method;
        pending.reject(error);
        return;
      }
      pending.resolve(message.result);
      return;
    }
    for (const subscriber of this.notificationSubscribers) {
      subscriber(message);
    }
  }

  async handleServerRequest(message = {}) {
    try {
      if (!this.requestHandler) {
        const error = new Error(`Codex app-server client does not handle server request: ${message.method || "(missing method)"}`);
        error.code = -32601;
        throw error;
      }
      const result = await this.requestHandler({
        id: message.id,
        method: message.method,
        params: message.params
      });
      this.send({
        id: message.id,
        result
      });
    } catch (error) {
      try {
        this.send({
          error: {
            code: Number.isSafeInteger(error?.code) ? error.code : -32000,
            message: normalizeAgentText(error?.message) || "Codex app-server client request failed."
          },
          id: message.id
        });
      } catch {
        // The app-server connection closed before the response could be delivered.
      }
    }
  }

  rejectPendingRequests(error) {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.removeAbortListener?.();
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  close() {
    this.rejectPendingRequests(new Error("Codex app-server connection closed."));
    const socket = this.socket;
    this.connected = false;
    this.socket = null;
    socket?.close?.();
  }
}

export { CodexAppServerJsonRpcClient, socketPathFromCodexAppServerEndpoint };
