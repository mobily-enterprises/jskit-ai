import { ACCOUNTS_TABLE } from "./accounts.js";
import { MODELS_TABLE } from "./adapter.js";
import { CLIENTS_TABLE } from "./clients.js";
import { EMAIL_TOKENS_TABLE } from "./emailTokens.js";
import { RATE_LIMITS_TABLE } from "./rateLimits.js";
import { SIGNING_KEYS_TABLE } from "./signingKeys.js";

export { HubConfigError, resolveHubConfig } from "./config.js";
export { hashPassword, verifyPassword } from "./crypto.js";
export { describeImport, importAccounts } from "./importAccounts.js";
export { HUB_GLOBAL_PATHS, createOidcIssuer } from "./issuer.js";
export { runPreviewIdentityCommand } from "./previewIdentity.js";

// The tables the accounts hub keeps outside table resources (its OpenID provider's protocol state, signing keys, own
// accounts and rate limits), for an app test's expectEveryTableOwned infrastructureTables.
const OIDC_ISSUER_INFRASTRUCTURE_TABLES = Object.freeze([
  ACCOUNTS_TABLE, CLIENTS_TABLE, EMAIL_TOKENS_TABLE, MODELS_TABLE, RATE_LIMITS_TABLE, SIGNING_KEYS_TABLE
]);

export { OIDC_ISSUER_INFRASTRUCTURE_TABLES };
