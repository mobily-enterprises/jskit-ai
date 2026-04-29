export { createAccountFlows } from "./accountFlows.js";
export { createOauthFlows } from "./oauthFlows.js";
export { createPasswordSecurityFlows } from "./passwordSecurityFlows.js";

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
} from "./authErrorMappers.js";

export {
  buildOtpLoginRedirectUrl,
  normalizeOAuthIntent,
  normalizeReturnToPath,
  buildOAuthRedirectUrl,
  buildOAuthLoginRedirectUrl,
  buildOAuthLinkRedirectUrl
} from "./authRedirectUrls.js";

export {
  normalizeOAuthProviderInput,
  mapOAuthCallbackError
} from "./authInputParsers.js";

export {
  resolveSupabaseOAuthProviderCatalog,
  resolveOAuthProviderQueryParams,
  buildOAuthProviderCatalogResponse
} from "./oauthProviderCatalog.js";

export {
  buildAuthMethodsStatusFromProviderIds,
  collectProviderIdsFromSupabaseUser,
  findAuthMethodById,
  findLinkedIdentityByProvider,
  buildSecurityStatusFromAuthMethodsStatus
} from "./authMethodStatus.js";
