export { createAccountFlows } from "./lib/accountFlows.js";
export { safeRequestCookies, cookieOptions } from "./lib/authCookies.js";
export {
  isTransientAuthMessage,
  isTransientSupabaseError,
  sanitizeAuthMessage,
  mapAuthError,
  validationError,
  isUserNotFoundLikeAuthError,
  mapRecoveryError,
  mapPasswordUpdateError,
  mapOtpVerifyError,
  mapProfileUpdateError,
  mapCurrentPasswordError
} from "./lib/authErrorMappers.js";
export {
  normalizeOAuthProviderInput,
  validatePasswordRecoveryPayload,
  parseOAuthCompletePayload,
  parseOtpLoginVerifyPayload,
  mapOAuthCallbackError
} from "./lib/authInputParsers.js";
export { loadJose, isExpiredJwtError, classifyJwtVerifyError } from "./lib/authJwt.js";
export {
  normalizeIdentityProviderId,
  collectProviderIdsFromSupabaseUser,
  buildAuthMethodsStatusFromProviderIds,
  buildAuthMethodsStatusFromSupabaseUser,
  buildSecurityStatusFromAuthMethodsStatus,
  findAuthMethodById,
  findLinkedIdentityByProvider
} from "./lib/authMethodStatus.js";
export { displayNameFromEmail, resolveDisplayName, resolveDisplayNameFromClaims } from "./lib/authProfileNames.js";
export {
  parseHttpUrl,
  buildPasswordResetRedirectUrl,
  buildOtpLoginRedirectUrl,
  normalizeOAuthIntent,
  normalizeReturnToPath,
  buildOAuthRedirectUrl,
  buildOAuthLoginRedirectUrl,
  buildOAuthLinkRedirectUrl
} from "./lib/authRedirectUrls.js";
export { buildDisabledPasswordSecret } from "./lib/authSecrets.js";
export { createOauthFlows } from "./lib/oauthFlows.js";
export { createPasswordSecurityFlows } from "./lib/passwordSecurityFlows.js";
