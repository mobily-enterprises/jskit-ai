function createInviteRetentionRules({ workspaceInvitesRepository, consoleInvitesRepository }) {
  if (!workspaceInvitesRepository || typeof workspaceInvitesRepository.deleteArtifactsOlderThan !== "function") {
    throw new Error("workspaceInvitesRepository.deleteArtifactsOlderThan is required.");
  }
  if (!consoleInvitesRepository || typeof consoleInvitesRepository.deleteArtifactsOlderThan !== "function") {
    throw new Error("consoleInvitesRepository.deleteArtifactsOlderThan is required.");
  }

  return [
    {
      id: "workspace_invites",
      retentionConfigKey: "inviteArtifactRetentionDays",
      async deleteBatch({ cutoffDate, batchSize }) {
        return workspaceInvitesRepository.deleteArtifactsOlderThan(cutoffDate, batchSize);
      }
    },
    {
      id: "console_invites",
      retentionConfigKey: "inviteArtifactRetentionDays",
      async deleteBatch({ cutoffDate, batchSize }) {
        return consoleInvitesRepository.deleteArtifactsOlderThan(cutoffDate, batchSize);
      }
    }
  ];
}

export { createInviteRetentionRules };
