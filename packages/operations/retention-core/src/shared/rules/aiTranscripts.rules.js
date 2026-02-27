function createAiTranscriptRetentionRules({ aiTranscriptMessagesRepository, aiTranscriptConversationsRepository }) {
  if (!aiTranscriptMessagesRepository || typeof aiTranscriptMessagesRepository.deleteOlderThan !== "function") {
    throw new Error("aiTranscriptMessagesRepository.deleteOlderThan is required.");
  }
  if (
    !aiTranscriptConversationsRepository ||
    typeof aiTranscriptConversationsRepository.deleteWithoutMessagesOlderThan !== "function"
  ) {
    throw new Error("aiTranscriptConversationsRepository.deleteWithoutMessagesOlderThan is required.");
  }

  return [
    {
      id: "ai_messages",
      retentionConfigKey: "aiTranscriptsRetentionDays",
      async deleteBatch({ cutoffDate, batchSize }) {
        return aiTranscriptMessagesRepository.deleteOlderThan(cutoffDate, batchSize);
      }
    },
    {
      id: "ai_conversations",
      retentionConfigKey: "aiTranscriptsRetentionDays",
      async deleteBatch({ cutoffDate, batchSize }) {
        return aiTranscriptConversationsRepository.deleteWithoutMessagesOlderThan(cutoffDate, batchSize);
      }
    }
  ];
}

export { createAiTranscriptRetentionRules };
