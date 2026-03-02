const retentionConfig = {
  errorLogDays: 30,
  inviteArtifactDays: 90,
  securityAuditDays: 365,
  aiTranscriptsDays: 60,
  chat: {
    messagesDays: 365,
    attachmentsDays: 365,
    messageIdempotencyRetryWindowHours: 72,
    emptyThreadCleanupEnabled: false
  }
};

export { retentionConfig };
