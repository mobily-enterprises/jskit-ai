const socialConfig = {
  enabled: true,
  federationEnabled: false,
  limits: {
    feedPageSizeMax: 50,
    commentsPageSizeMax: 50,
    notificationsPageSizeMax: 50,
    actorSearchLimitMax: 50,
    postMaxChars: 5000,
    commentMaxChars: 2000,
    inboxMaxPayloadBytes: 1_000_000
  },
  retry: {
    baseDelayMs: 30_000,
    maxDelayMs: 1_800_000,
    maxAttempts: 8,
    jitterRatio: 0.2
  },
  moderation: {
    requireManualApprovalForRemoteFollows: false,
    autoSuspendOnRepeatedSignatureFailures: true,
    signatureFailureSuspendThreshold: 5,
    defaultBlockedDomains: []
  }
};

export { socialConfig };
