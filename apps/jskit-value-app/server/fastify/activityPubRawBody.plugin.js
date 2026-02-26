import { Transform } from "node:stream";
import fp from "fastify-plugin";
import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { safePathnameFromRequest } from "@jskit-ai/server-runtime-core/requestUrl";

function isActivityPubInboxPath(pathnameValue) {
  const pathname = String(pathnameValue || "").trim();
  if (!pathname) {
    return false;
  }

  if (pathname === "/ap/inbox") {
    return true;
  }

  return /^\/ap\/actors\/[^/]+\/inbox$/u.test(pathname);
}

async function activityPubRawBodyPlugin(fastify, options = {}) {
  const maxPayloadBytes = Math.max(1024, Number(options.maxPayloadBytes || 1_000_000) || 1_000_000);

  if (!fastify.hasRequestDecorator("rawBody")) {
    fastify.decorateRequest("rawBody", null);
  }

  fastify.addHook("preParsing", async (request, _reply, payload) => {
    if (request.method !== "POST") {
      return payload;
    }

    const pathnameValue = safePathnameFromRequest(request);
    if (!isActivityPubInboxPath(pathnameValue)) {
      return payload;
    }

    const contentLength = Number(request.headers?.["content-length"] || 0);
    if (Number.isFinite(contentLength) && contentLength > maxPayloadBytes) {
      throw new AppError(413, "ActivityPub payload is too large.");
    }

    const chunks = [];
    let totalBytes = 0;

    const transformer = new Transform({
      transform(chunk, _encoding, callback) {
        const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += bufferChunk.length;
        if (totalBytes > maxPayloadBytes) {
          callback(new AppError(413, "ActivityPub payload is too large."));
          return;
        }

        chunks.push(bufferChunk);
        callback(null, bufferChunk);
      },
      flush(callback) {
        request.rawBody = Buffer.concat(chunks);
        callback();
      }
    });

    payload.pipe(transformer);
    return transformer;
  });
}

export default fp(activityPubRawBodyPlugin);
