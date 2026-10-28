import { createHash } from "node:crypto";

// code is the stable payment_* code callers branch on; a code shared by several
// sentences adds a messageCode (and messageParams) naming this sentence.
class PaymentError extends Error {
  constructor(code, message, statusCode = 422, { messageCode = "", messageParams = {} } = {}) {
    super(message);
    this.name = "PaymentError";
    this.code = code;
    this.statusCode = statusCode;
    if (messageCode) {
      this.messageCode = messageCode;
      this.messageParams = { ...messageParams };
    }
  }
}

// Stable sha256 hex of a JSON value: idempotency digests, review IDs and store keys.
const fingerprint = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export { PaymentError, fingerprint };
