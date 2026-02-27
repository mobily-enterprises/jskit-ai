function createNoopObservabilityAdapter() {
  return {
    recordExecutionStart() {},
    recordExecutionFinish() {},
    recordAuthorizationDenied() {},
    recordValidationFailure() {},
    recordIdempotentReplay() {}
  };
}

export { createNoopObservabilityAdapter };
