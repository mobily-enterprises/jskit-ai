// What the Google Ads provider and its Search extension share: the API they call, the
// permission every operation needs and the header that acts through a manager account.

const googleAdsOrigin = "https://googleads.googleapis.com";
const googleAdsApi = `${googleAdsOrigin}/v25`;
const googleAdsScope = "https://www.googleapis.com/auth/adwords";

/**
 * The header that sends a request as the configured manager account, when there is one.
 * @param {{ loginCustomerId?: string }} settings
 */
const loginCustomerHeaders = (settings) => settings.loginCustomerId ? { "login-customer-id": settings.loginCustomerId } : {};

export { googleAdsOrigin, googleAdsApi, googleAdsScope, loginCustomerHeaders };
