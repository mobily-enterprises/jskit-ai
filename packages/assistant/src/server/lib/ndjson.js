const NDJSON_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";

function setNdjsonHeaders(reply) {
  // Fastify reply.hijack bypasses part of reply serialization. Set headers on both
  // Fastify reply and the underlying raw response to keep streaming content-type intact.
  reply.header("Content-Type", NDJSON_CONTENT_TYPE);
  reply.header("Cache-Control", "no-cache");
  reply.header("X-Accel-Buffering", "no");

  if (reply?.raw && typeof reply.raw.setHeader === "function") {
    reply.raw.setHeader("Content-Type", NDJSON_CONTENT_TYPE);
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("X-Accel-Buffering", "no");
  }
}

function writeNdjson(reply, payload = {}) {
  const body = `${JSON.stringify(payload)}\n`;
  reply.raw.write(body);
}

function endNdjson(reply) {
  if (!reply || !reply.raw || reply.raw.writableEnded) {
    return;
  }

  reply.raw.end();
}

function mapStreamError(error) {
  const status = Number(error?.status || error?.statusCode || 500);
  const safeStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;

  return Object.freeze({
    code: String(error?.code || "assistant_stream_failed").trim() || "assistant_stream_failed",
    message: safeStatus >= 500 ? "Assistant stream failed." : String(error?.message || "Request failed."),
    status: safeStatus
  });
}

export {
  NDJSON_CONTENT_TYPE,
  setNdjsonHeaders,
  writeNdjson,
  endNdjson,
  mapStreamError
};
