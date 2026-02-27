function createNoopAuditAdapter() {
  return {
    async emitExecution() {}
  };
}

export { createNoopAuditAdapter };
