function setNdjsonHeaders(reply) {
  reply.header("Content-Type", "application/x-ndjson; charset=utf-8");
  reply.header("Cache-Control", "no-cache, no-transform");
  reply.header("Connection", "keep-alive");
}

function canWriteToReply(reply) {
  const raw = reply?.raw;
  if (!raw || typeof raw.write !== "function") {
    return false;
  }

  return raw.destroyed !== true && raw.writableEnded !== true;
}

function writeNdjson(reply, payload) {
  if (!canWriteToReply(reply)) {
    return false;
  }

  try {
    const line = `${JSON.stringify(payload)}\n`;
    reply.raw.write(line);
    return true;
  } catch {
    return false;
  }
}

function endNdjson(reply) {
  if (!reply || !reply.raw || typeof reply.raw.end !== "function") {
    return;
  }

  if (reply.raw.destroyed === true || reply.raw.writableEnded === true) {
    return;
  }

  try {
    reply.raw.end();
  } catch {
    // Ignore stream finalization failures.
  }
}

function safeStreamError(reply, payload) {
  try {
    writeNdjson(reply, payload);
  } finally {
    endNdjson(reply);
  }
}

export { setNdjsonHeaders, writeNdjson, endNdjson, safeStreamError };
