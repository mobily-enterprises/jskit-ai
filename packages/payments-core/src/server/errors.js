import { createHash } from "node:crypto";

class PaymentError extends Error {
  constructor(code, message, statusCode = 422) {
    super(message);
    this.name = "PaymentError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

// Stable sha256 hex of a JSON value: idempotency digests, review IDs and store keys.
const fingerprint = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export { PaymentError, fingerprint };
