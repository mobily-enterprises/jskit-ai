import { createJsonRestContext } from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";

const FEATURE_RESOURCE_KEY = "${option:feature-name|camel}";
const FEATURE_RESOURCE_TYPE = "${option:feature-name|kebab}";

function createRepository({ api } = {}) {
  if (!api) {
    throw new TypeError("createRepository requires api.");
  }

  return Object.freeze({
    async getStatus(input = {}, options = {}) {
      const jsonRestContext = createJsonRestContext(options?.context || null);
      const featureResource = api?.resources?.[FEATURE_RESOURCE_KEY] || null;

      return {
        ok: true,
        feature: FEATURE_RESOURCE_TYPE,
        persistence: "json-rest",
        resourceKey: FEATURE_RESOURCE_KEY,
        resourceAvailable: Boolean(featureResource),
        hasContext: Boolean(jsonRestContext),
        input
      };
    },
    async execute(input = {}, options = {}) {
      const jsonRestContext = createJsonRestContext(options?.context || null);
      const featureResource = api?.resources?.[FEATURE_RESOURCE_KEY] || null;

      return {
        accepted: false,
        feature: FEATURE_RESOURCE_TYPE,
        persistence: "json-rest",
        resourceKey: FEATURE_RESOURCE_KEY,
        resourceAvailable: Boolean(featureResource),
        hasContext: Boolean(jsonRestContext),
        input,
        message: "Customize repository.execute() to read and write through internal json-rest-api."
      };
    }
  });
}

export { createRepository };
