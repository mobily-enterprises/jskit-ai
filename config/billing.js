const billingConfig = {
  enabled: true,
  provider: "stripe",
  currency: "USD",
  idempotency: {
    providerReplayWindowSeconds: 23 * 60 * 60,
    pendingLeaseSeconds: 120
  },
  checkout: {
    providerExpiresSeconds: 24 * 60 * 60,
    sessionExpiresAtGraceSeconds: 90,
    completionSlaSeconds: 5 * 60,
    debugBlockingCheckoutLogsEnabled: false
  },
  workers: {
    outbox: {
      retryDelaySeconds: 60,
      maxAttempts: 8
    },
    remediation: {
      retryDelaySeconds: 120,
      maxAttempts: 6
    }
  },
  retention: {
    idempotencyDays: 30,
    webhookPayloadDays: 30
  }
};

export { billingConfig };
