function createNoopObservabilityAdapter() {
  return {
    recordExecutionStart() {},
    recordExecutionFinish() {},
    recordValidationFailure() {},
    recordIdempotentReplay() {}
  };
}

export { createNoopObservabilityAdapter };
