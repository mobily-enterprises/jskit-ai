import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { catalogMessage, formatMessage, messageKeyForCode } from "@jskit-ai/kernel/shared/i18n";
import english from "../../locales/en.json" with { type: "json" };

// Why a one-time sign-in pass was refused, one entry per reason. verifyPass throws the first five; the application
// that signs people in with passes throws the last two, when it finds a pass used before or naming nobody it knows.
const PASS_TEXTS = Object.freeze({
  passMalformed: Object.freeze({ status: 401, code: "auth.pass.malformed" }),
  passBadSignature: Object.freeze({ status: 401, code: "auth.pass.badSignature" }),
  passExpired: Object.freeze({ status: 401, code: "auth.pass.expired" }),
  passWrongAudience: Object.freeze({ status: 401, code: "auth.pass.wrongAudience" }),
  passWrongResource: Object.freeze({ status: 401, code: "auth.pass.wrongResource" }),
  passReplayed: Object.freeze({ status: 401, code: "auth.pass.replayed" }),
  passUnmapped: Object.freeze({ status: 403, code: "auth.pass.unmapped" })
});

/**
 * The refusal for one PASS_TEXTS entry: an AppError with its status, its code and this package's English for it.
 * @param {{ status: number, code: string }} entry
 */
function createPassError(entry) {
  const template = catalogMessage(english, messageKeyForCode(entry.code));
  if (template === undefined) {
    throw new TypeError(`Pass text "${entry.code}" is not in auth-pass's catalog.`);
  }
  return new AppError(entry.status, formatMessage(template, {}), { code: entry.code, params: {} });
}

export { PASS_TEXTS, createPassError };
