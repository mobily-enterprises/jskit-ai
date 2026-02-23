const chatConfig = {
  enabled: true,
  workspaceThreadsEnabled: true,
  globalDmsEnabled: true,
  globalDmsRequireSharedWorkspace: true,
  attachmentsEnabled: true,
  messageMaxTextChars: 4000,
  messagesPageSizeMax: 100,
  threadsPageSizeMax: 50,
  attachmentsMaxFilesPerMessage: 5,
  attachmentMaxUploadBytes: 20_000_000,
  unattachedUploadRetentionHours: 24
};

export { chatConfig };
