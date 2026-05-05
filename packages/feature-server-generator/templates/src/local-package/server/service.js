function createService({ featureRepository } = {}) {
__JSKIT_FEATURE_SERVICE_REPOSITORY_GUARD__

  return Object.freeze({
    async getStatus(input = {}, options = {}) {
__JSKIT_FEATURE_SERVICE_GET_STATUS_BODY__
    },
    async execute(input = {}, options = {}) {
__JSKIT_FEATURE_SERVICE_EXECUTE_BODY__
    }
  });
}

export { createService };
