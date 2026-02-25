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
  workers: {
    outboxPollSeconds: 10,
    outboxWorkspaceBatchSize: 25
  },
  identity: {
    treatHandleWithDomainAsRemote: true,
    allowRemoteLookupForLocalHandles: false
  },
  moderation: {
    accessMode: "permission",
    requireManualApprovalForRemoteFollows: false,
    autoSuspendOnRepeatedSignatureFailures: true,
    signatureFailureSuspendThreshold: 5,
    defaultBlockedDomains: []
  }
};

export { socialConfig };
