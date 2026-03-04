import { Container, createContainer, tokenLabel } from "./lib/container.js";
import * as containerErrors from "./lib/errors.js";

const CONTAINER_CORE_API = Object.freeze({
  Container,
  createContainer,
  tokenLabel,
  errors: Object.freeze({
    ...containerErrors
  })
});

class ContainerCoreServiceProvider {
  static id = "runtime.container";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("ContainerCoreServiceProvider requires application singleton().");
    }

    app.singleton("runtime.container", () => CONTAINER_CORE_API);
  }

  boot() {}
}

export { ContainerCoreServiceProvider };
