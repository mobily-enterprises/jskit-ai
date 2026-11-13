import { isJsonContentType } from "../validators/jsonApiTransport.js";

/** Reads a JSON response body; a body that is not JSON reads as an empty object. */
function parseJsonSafely(response, signal) {
  // readable-check: allow optional-call - platform object: another fetch implementation's Response may lack headers.get()
  const contentType = String(response?.headers?.get?.("content-type") || "");
  const isJson = isJsonContentType(contentType);
  if (!isJson) {
    return Promise.resolve({
      contentType,
      isJson,
      data: {}
    });
  }

  // readable-check: allow optional-call - platform object: another fetch implementation's Response may lack json()
  return Promise.resolve(response?.json?.())
    .catch((error) => {
      signal?.throwIfAborted();
      if (error?.name === "AbortError") {
        throw error;
      }
      return {};
    })
    .then((data) => ({
      contentType,
      isJson,
      data: data && typeof data === "object" ? data : {}
    }));
}

/**
 * @param {string} line
 * @param {NdjsonHandlers} handlers
 */
function emitNdjsonLine(line, handlers) {
  const normalizedLine = String(line || "").trim();
  if (!normalizedLine) {
    return;
  }

  try {
    handlers.onEvent(JSON.parse(normalizedLine));
  } catch (error) {
    handlers.onMalformedLine(normalizedLine, error);
  }
}

/** @typedef {{ onEvent: (payload: any) => void, onMalformedLine: (line: string, error: unknown) => void }} NdjsonHandlers */

/**
 * Calls handlers.onEvent with each NDJSON line of the response's whole text.
 * @param {any} response
 * @param {NdjsonHandlers} handlers
 */
async function readNdjsonText(response, handlers) {
  // readable-check: allow method-probe - platform object: another fetch implementation's Response may lack text()
  if (typeof response.text !== "function") {
    return;
  }
  const rawText = await response.text().catch(() => "");
  for (const line of String(rawText || "").split(/\r?\n/g)) {
    emitNdjsonLine(line, handlers);
  }
}

/**
 * Calls handlers.onEvent with each NDJSON line of the response body, as it arrives.
 * @param {any} response
 * @param {NdjsonHandlers} handlers
 */
async function readNdjsonStream(response, handlers) {
  // readable-check: allow method-probe - platform object: another fetch implementation's Response may lack a readable body
  if (!response.body || typeof response.body.getReader !== "function") {
    await readNdjsonText(response, handlers);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffered += decoder.decode(value, {
      stream: true
    });

    const lines = buffered.split(/\r?\n/g);
    buffered = lines.pop() || "";
    for (const line of lines) {
      emitNdjsonLine(line, handlers);
    }
  }

  buffered += decoder.decode();
  if (buffered) {
    emitNdjsonLine(buffered, handlers);
  }
}


/**
 * A Content-Disposition parameter's value: a quoted string without its quotes and escapes, anything else trimmed.
 * @param {string} raw
 */
function dispositionValue(raw) {
  const text = raw.trim();
  if (text.length >= 2 && text.startsWith("\"") && text.endsWith("\"")) {
    return text.slice(1, -1).replace(/\\(.)/gu, "$1");
  }
  return text;
}

/**
 * An RFC 8187 extended value (`UTF-8''%E2%82%AC%20rates.csv`) decoded, or null when it is not UTF-8 or is malformed.
 * @param {string} raw
 */
function extendedDispositionValue(raw) {
  const match = /^utf-8'[^']*'(.+)$/iu.exec(raw);
  if (!match) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/**
 * The file name a Content-Disposition header gives, or null when it gives none. As RFC 6266 asks, the extended
 * `filename*` wins over the plain `filename` when both are present and the extended one can be read.
 * @param {string | null} header
 */
function contentDispositionFileName(header) {
  const parameters = new Map();
  // Each parameter after a `;`, its value a quoted string (which may hold `;`) or a token: a parameter's first
  // occurrence counts.
  for (const [, name, value] of String(header || "").matchAll(/;\s*([^\s=;]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^;]*)/gu)) {
    const key = name.toLowerCase();
    if (!parameters.has(key)) {
      parameters.set(key, dispositionValue(value));
    }
  }
  const extended = parameters.has("filename*") ? extendedDispositionValue(parameters.get("filename*")) : null;
  return extended || parameters.get("filename") || null;
}

/**
 * A file answer: its body as a Blob, the file name its Content-Disposition gives (null when none) and its content
 * type.
 * @param {Response} response
 * @param {string} contentType
 */
async function readFileResponse(response, contentType) {
  const blob = await response.blob();
  return Object.freeze({
    blob,
    fileName: contentDispositionFileName(response.headers.get("content-disposition")),
    contentType
  });
}

export { emitNdjsonLine, parseJsonSafely, readFileResponse, readNdjsonStream, readNdjsonText };
