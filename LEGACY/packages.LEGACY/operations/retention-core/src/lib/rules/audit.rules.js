function createAuditRetentionRules({ auditEventsRepository }) {
  if (!auditEventsRepository || typeof auditEventsRepository.deleteOlderThan !== "function") {
    throw new Error("auditEventsRepository.deleteOlderThan is required.");
  }

  return [
    {
      id: "security_audit_events",
      retentionConfigKey: "securityAuditRetentionDays",
      async deleteBatch({ cutoffDate, batchSize }) {
        return auditEventsRepository.deleteOlderThan(cutoffDate, batchSize);
      }
    }
  ];
}

export { createAuditRetentionRules };
