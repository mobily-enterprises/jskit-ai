import * as httpContracts from "../../lib/index.js";

const HTTP_CONTRACTS_API = Object.freeze({
  ...httpContracts
});

class HttpContractsServiceProvider {
  static id = "contracts.http";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("HttpContractsServiceProvider requires application singleton().");
    }

    app.singleton("contracts.http", () => HTTP_CONTRACTS_API);
  }

  boot() {}
}

export { HttpContractsServiceProvider };
