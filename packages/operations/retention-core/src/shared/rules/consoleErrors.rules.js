function createConsoleErrorRetentionRules({ consoleErrorLogsRepository }) {
  if (!consoleErrorLogsRepository) {
    throw new Error("consoleErrorLogsRepository is required.");
  }
  if (typeof consoleErrorLogsRepository.deleteBrowserErrorsOlderThan !== "function") {
    throw new Error("consoleErrorLogsRepository.deleteBrowserErrorsOlderThan is required.");
  }
  if (typeof consoleErrorLogsRepository.deleteServerErrorsOlderThan !== "function") {
    throw new Error("consoleErrorLogsRepository.deleteServerErrorsOlderThan is required.");
  }

  return [
    {
      id: "console_browser_errors",
      retentionConfigKey: "errorLogRetentionDays",
      async deleteBatch({ cutoffDate, batchSize }) {
        return consoleErrorLogsRepository.deleteBrowserErrorsOlderThan(cutoffDate, batchSize);
      }
    },
    {
      id: "console_server_errors",
      retentionConfigKey: "errorLogRetentionDays",
      async deleteBatch({ cutoffDate, batchSize }) {
        return consoleErrorLogsRepository.deleteServerErrorsOlderThan(cutoffDate, batchSize);
      }
    }
  ];
}

export { createConsoleErrorRetentionRules };
