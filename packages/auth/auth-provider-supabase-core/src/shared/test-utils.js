export { createAccountFlows } from "./lib/accountFlows.js";
export { createOauthFlows } from "./lib/oauthFlows.js";
export { createPasswordSecurityFlows } from "./lib/passwordSecurityFlows.js";

export {
  mapAuthError,
  validationError,
  isUserNotFoundLikeAuthError,
  mapRecoveryError,
  mapPasswordUpdateError,
  mapOtpVerifyError,
  mapProfileUpdateError,
  mapCurrentPasswordError,
  isTransientAuthMessage,
  isTransientSupabaseError
} from "./lib/authErrorMappers.js";

export {
  buildOtpLoginRedirectUrl,
  normalizeOAuthIntent,
  normalizeReturnToPath,
  buildOAuthRedirectUrl,
  buildOAuthLoginRedirectUrl,
  buildOAuthLinkRedirectUrl
} from "./lib/authRedirectUrls.js";

export {
  normalizeOAuthProviderInput,
  parseOAuthCompletePayload,
  parseOtpLoginVerifyPayload,
  mapOAuthCallbackError,
  validatePasswordRecoveryPayload
} from "./lib/authInputParsers.js";

export {
  resolveSupabaseOAuthProviderCatalog,
  resolveOAuthProviderQueryParams,
  buildOAuthProviderCatalogResponse
} from "./lib/oauthProviderCatalog.js";

export {
  buildAuthMethodsStatusFromProviderIds,
  collectProviderIdsFromSupabaseUser,
  findAuthMethodById,
  findLinkedIdentityByProvider,
  buildSecurityStatusFromAuthMethodsStatus
} from "./lib/authMethodStatus.js";
