import { isJsonContentType } from "../validators/jsonApiTransport.js";

/** Reads a JSON response body; a body that is not JSON reads as an empty object. */
function parseJsonSafely(response, signal) {
  const contentType = String(response?.headers?.get?.("content-type") || "");
  const isJson = isJsonContentType(contentType);
  if (!isJson) {
    return Promise.resolve({
      contentType,
      isJson,
      data: {}
    });
  }

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

function emitNdjsonLine(line, handlers) {
  const normalizedLine = String(line || "").trim();
  if (!normalizedLine) {
    return;
  }

  try {
    const payload = JSON.parse(normalizedLine);
    if (typeof handlers?.onEvent === "function") {
      handlers.onEvent(payload);
    }
  } catch (error) {
    if (typeof handlers?.onMalformedLine === "function") {
      handlers.onMalformedLine(normalizedLine, error);
    }
  }
}

/** Calls handlers.onEvent with each NDJSON line of the response body, as it arrives. */
async function readNdjsonStream(response, handlers = {}) {
  if (!response?.body || typeof response.body.getReader !== "function") {
    if (typeof response?.text === "function") {
      const rawText = await response.text().catch(() => "");
      for (const line of String(rawText || "").split(/\r?\n/g)) {
        emitNdjsonLine(line, handlers);
      }
    }
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

export { emitNdjsonLine, parseJsonSafely, readNdjsonStream };
