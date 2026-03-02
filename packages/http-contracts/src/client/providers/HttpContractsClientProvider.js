import * as httpContracts from "../../lib/index.js";

const HTTP_CONTRACTS_CLIENT_API = Object.freeze({
  ...httpContracts
});

class HttpContractsClientProvider {
  static id = "contracts.http.client";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("HttpContractsClientProvider requires application singleton().");
    }

    app.singleton("contracts.http.client", () => HTTP_CONTRACTS_CLIENT_API);
  }

  boot() {}
}

export { HttpContractsClientProvider };
