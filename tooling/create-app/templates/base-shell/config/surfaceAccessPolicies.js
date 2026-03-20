export const surfaceAccessPolicies = {};

surfaceAccessPolicies.public = {};

surfaceAccessPolicies.authenticated = {
  requireAuth: true
};

surfaceAccessPolicies.console_owner = {
  requireAuth: true,
  requireFlagsAll: ["console_owner"]
};
