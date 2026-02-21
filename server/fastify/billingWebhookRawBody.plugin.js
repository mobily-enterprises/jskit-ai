import { Transform } from "node:stream";
import fp from "fastify-plugin";
import { AppError } from "../lib/errors.js";
import { safePathnameFromRequest } from "../lib/primitives/requestUrl.js";
import { STRIPE_PHASE1_DEFAULTS } from "../modules/billing/constants.js";

const STRIPE_WEBHOOK_PATH = "/api/billing/webhooks/stripe";

async function billingWebhookRawBodyPlugin(fastify, options = {}) {
  const maxPayloadBytes = Math.max(
    1,
    Number(options.maxPayloadBytes || STRIPE_PHASE1_DEFAULTS.WEBHOOK_MAX_PAYLOAD_BYTES) ||
      STRIPE_PHASE1_DEFAULTS.WEBHOOK_MAX_PAYLOAD_BYTES
  );

  if (!Object.prototype.hasOwnProperty.call(fastify, "rawBody")) {
    fastify.decorateRequest("rawBody", null);
  }

  fastify.addHook("preParsing", async (request, _reply, payload) => {
    if (safePathnameFromRequest(request) !== STRIPE_WEBHOOK_PATH) {
      return payload;
    }

    const contentLength = Number(request.headers?.["content-length"] || 0);
    if (Number.isFinite(contentLength) && contentLength > maxPayloadBytes) {
      throw new AppError(413, "Billing webhook payload is too large.");
    }

    const chunks = [];
    let totalBytes = 0;

    const transformer = new Transform({
      transform(chunk, _encoding, callback) {
        const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += bufferChunk.length;
        if (totalBytes > maxPayloadBytes) {
          callback(new AppError(413, "Billing webhook payload is too large."));
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

export default fp(billingWebhookRawBodyPlugin);
