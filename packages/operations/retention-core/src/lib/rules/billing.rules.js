function createBillingRetentionRules({ billingRepository = null }) {
  if (!billingRepository) {
    return [];
  }
  if (typeof billingRepository.deleteTerminalIdempotencyOlderThan !== "function") {
    throw new Error("billingRepository.deleteTerminalIdempotencyOlderThan is required.");
  }
  if (typeof billingRepository.scrubWebhookPayloadsPastRetention !== "function") {
    throw new Error("billingRepository.scrubWebhookPayloadsPastRetention is required.");
  }

  return [
    {
      id: "billing_idempotency_requests",
      retentionConfigKey: "billingIdempotencyRetentionDays",
      async deleteBatch({ cutoffDate, batchSize }) {
        return billingRepository.deleteTerminalIdempotencyOlderThan(cutoffDate, batchSize);
      }
    },
    {
      id: "billing_webhook_payloads",
      retentionConfigKey: "billingWebhookPayloadRetentionDays",
      async deleteBatch({ nowDate, batchSize }) {
        return billingRepository.scrubWebhookPayloadsPastRetention({
          now: nowDate,
          batchSize
        });
      }
    }
  ];
}

export { createBillingRetentionRules };
