const aiConfig = {
  enabled: true,
  model: "deepseek-chat",
  maxInputChars: 8000,
  maxHistoryMessages: 20,
  maxToolCallsPerTurn: 4,
  streamTimeoutMs: 90_000,
  historyPageSize: 100,
  restoreMessagesPageSize: 200,
  requiredPermission: ""
};

export { aiConfig };
