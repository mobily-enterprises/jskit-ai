import { DefaultLoginView } from "../views/DefaultLoginView.vue";
import { initializeAuthGuardRuntime } from "../runtime/authGuardRuntime.js";
import { useLoginView } from "../runtime/useLoginView.js";

class AuthWebClientProvider {
  static id = "auth.web.client";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("AuthWebClientProvider requires application singleton().");
    }

    app.singleton("auth.login.component", () => DefaultLoginView);
    app.singleton("auth.login.useLoginView", () => useLoginView);
  }

  async boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("AuthWebClientProvider requires application make().");
    }

    await initializeAuthGuardRuntime({ loginRoute: "/login" });
  }
}

export { AuthWebClientProvider };
