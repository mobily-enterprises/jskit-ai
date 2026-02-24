const BILLING_PROVIDER_STRIPE = "stripe";
const BILLING_PROVIDER_PADDLE = "paddle";
const BILLING_DEFAULT_PROVIDER = BILLING_PROVIDER_STRIPE;

const BILLING_PROVIDER_SDK_NAME_BY_PROVIDER = Object.freeze({
  [BILLING_PROVIDER_STRIPE]: "stripe-node",
  [BILLING_PROVIDER_PADDLE]: "paddle-rest"
});

function resolveProviderSdkName(provider) {
  const normalizedProvider = String(provider || "")
    .trim()
    .toLowerCase();
  const providerKey = normalizedProvider || BILLING_DEFAULT_PROVIDER;
  return BILLING_PROVIDER_SDK_NAME_BY_PROVIDER[providerKey] || `${providerKey}-sdk`;
}

export {
  BILLING_PROVIDER_STRIPE,
  BILLING_PROVIDER_PADDLE,
  BILLING_DEFAULT_PROVIDER,
  BILLING_PROVIDER_SDK_NAME_BY_PROVIDER,
  resolveProviderSdkName
};
