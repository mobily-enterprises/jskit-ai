import { registerJsonRestApiHost } from "./jsonRestApiHost.js";

class JsonRestApiCoreServiceProvider {
  static id = "json-rest-api.core";

  async boot(app) {
    await registerJsonRestApiHost(app);
  }
}

export { JsonRestApiCoreServiceProvider };
