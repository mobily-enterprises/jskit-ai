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

export { emitNdjsonLine, parseJsonSafely, readNdjsonStream, readNdjsonText };
