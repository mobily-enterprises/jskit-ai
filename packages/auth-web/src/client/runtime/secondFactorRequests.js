import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import { authHttpRequest } from "./authHttpClient.js";

// The signed-in person's second factor, through auth-web's routes. A proof is a code from the authenticator app or one
// of the recovery codes.

/** @returns {Promise<import("../types.js").SecondFactorStatus>} */
function readSecondFactor() {
  return authHttpRequest(AUTH_PATHS.SECOND_FACTOR, { method: "GET" });
}

/** @returns {Promise<import("../types.js").SecondFactorSetup>} */
function startSecondFactorSetup() {
  return authHttpRequest(AUTH_PATHS.SECOND_FACTOR_SETUP, { method: "POST" });
}

/**
 * @param {import("../types.js").SecondFactorProof} proof The authenticator's first code.
 * @returns {Promise<import("../types.js").SecondFactorRecoveryCodes>}
 */
function confirmSecondFactorSetup(proof) {
  return authHttpRequest(AUTH_PATHS.SECOND_FACTOR_SETUP_CONFIRM, { method: "POST", body: proof });
}

/**
 * @param {import("../types.js").SecondFactorProof} proof
 * @returns {Promise<{ verifiedAt: string, method: "code" | "recoveryCode", recoveryCodesLeft: number }>}
 */
function verifySecondFactor(proof) {
  return authHttpRequest(AUTH_PATHS.SECOND_FACTOR_VERIFY, { method: "POST", body: proof });
}

/**
 * @param {import("../types.js").SecondFactorProof} proof
 * @returns {Promise<import("../types.js").SecondFactorRecoveryCodes>}
 */
function replaceSecondFactorRecoveryCodes(proof) {
  return authHttpRequest(AUTH_PATHS.SECOND_FACTOR_RECOVERY_CODES, { method: "POST", body: proof });
}

/**
 * @param {import("../types.js").SecondFactorProof} proof
 * @returns {Promise<{ ok: true }>}
 */
function removeSecondFactor(proof) {
  return authHttpRequest(AUTH_PATHS.SECOND_FACTOR, { method: "DELETE", body: proof });
}

export {
  confirmSecondFactorSetup,
  readSecondFactor,
  removeSecondFactor,
  replaceSecondFactorRecoveryCodes,
  startSecondFactorSetup,
  verifySecondFactor
};
