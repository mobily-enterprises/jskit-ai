// The redirect address an app registers at its issuer is the app's normal
// sign-in page; auth-web completes the callback there.
const AUTH_OIDC_PROVIDER_ID = "oidc";
const AUTH_OIDC_REDIRECT_PATH = "/auth/login";
const AUTH_OIDC_BACKCHANNEL_LOGOUT_PATH = "/api/auth/oidc/backchannel-logout";
const AUTH_OIDC_LOGOUT_PATH = "/api/auth/oidc/logout";
const AUTH_OIDC_DEFAULT_LABEL = "Continue with your account";

export {
  AUTH_OIDC_BACKCHANNEL_LOGOUT_PATH,
  AUTH_OIDC_DEFAULT_LABEL,
  AUTH_OIDC_LOGOUT_PATH,
  AUTH_OIDC_PROVIDER_ID,
  AUTH_OIDC_REDIRECT_PATH
};
