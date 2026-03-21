class SingletonApiProvider {
  static bindingToken = "";

  static api = null;

  static providerName = "SingletonApiProvider";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error(`${this.constructor.providerName} requires application singleton().`);
    }

    const bindingToken = String(this.constructor.bindingToken || "").trim();
    if (!bindingToken) {
      throw new Error(`${this.constructor.providerName} requires static bindingToken.`);
    }
    if (!this.constructor.api || typeof this.constructor.api !== "object") {
      throw new Error(`${this.constructor.providerName} requires static api object.`);
    }

    app.singleton(bindingToken, () => this.constructor.api);
  }

  boot() {}
}

export { SingletonApiProvider };
