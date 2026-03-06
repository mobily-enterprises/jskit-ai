import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";

const STAGE_10_REQUEST_CONTEXT_TOKEN = "docs.examples.03.stage10.requestContext";

async function requireRequestScopeMiddleware(request, reply) {
  if (!request?.scope || typeof request.scope.make !== "function") {
    reply.code(500).send({
      error: "Request scope is unavailable.",
      code: "missing_request_scope"
    });
  }
}

async function attachRequestContextMiddleware(request) {
  const scope = request?.scope;
  if (!scope || typeof scope.instance !== "function" || typeof scope.make !== "function") {
    return;
  }

  const requestId = scope.make(KERNEL_TOKENS.RequestId);
  scope.instance(STAGE_10_REQUEST_CONTEXT_TOKEN, {
    requestId,
    receivedAt: new Date().toISOString()
  });
}

async function requirePartnerConsentMiddleware(request, reply) {
  const payload = request?.input?.body || request?.body || {};
  const source = String(payload?.source || "").trim().toLowerCase();
  const hasMarketingConsent = payload?.consentMarketing === true;

  if (source === "partner" && !hasMarketingConsent) {
    reply.code(422).send({
      error: "Domain validation failed.",
      code: "partner_consent_required",
      details: {
        fieldErrors: {
          consentMarketing: "partner leads require marketing consent"
        }
      }
    });
  }
}

const stage10ContactsMiddleware = Object.freeze([
  requireRequestScopeMiddleware,
  attachRequestContextMiddleware,
  requirePartnerConsentMiddleware
]);

export {
  STAGE_10_REQUEST_CONTEXT_TOKEN,
  requireRequestScopeMiddleware,
  attachRequestContextMiddleware,
  requirePartnerConsentMiddleware,
  stage10ContactsMiddleware
};
