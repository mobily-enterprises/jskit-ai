import { registerJsonRestApiHost } from "./jsonRestApiHost.js";

class JsonRestApiCoreServiceProvider {
  static id = "json-rest-api.core";

  static dependsOn = ["runtime.database"];

  async boot(app) {
    await registerJsonRestApiHost(app);
  }
}

export { JsonRestApiCoreServiceProvider };
