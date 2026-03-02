import { Container, createContainer, tokenLabel } from "../../lib/container.js";
import * as containerErrors from "../../lib/errors.js";

const CONTAINER_CORE_CLIENT_API = Object.freeze({
  Container,
  createContainer,
  tokenLabel,
  errors: Object.freeze({
    ...containerErrors
  })
});

class ContainerCoreClientProvider {
  static id = "runtime.container.client";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("ContainerCoreClientProvider requires application singleton().");
    }

    app.singleton("runtime.container.client", () => CONTAINER_CORE_CLIENT_API);
  }

  boot() {}
}

export { ContainerCoreClientProvider };
