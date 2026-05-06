import { h, render } from "vue";
import GoogleRewardedGateHost from "../components/GoogleRewardedGateHost.vue";
import {
  GOOGLE_REWARDED_RUNTIME_INJECTION_KEY,
  createGoogleRewardedRuntime
} from "../runtime/googleRewardedRuntime.js";

class GoogleRewardedClientProvider {
  static id = "google-rewarded.web.client";

  static dependsOn = ["shell.web.client"];

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("GoogleRewardedClientProvider requires application singleton().");
    }

    app.singleton("google-rewarded.web.runtime", () => createGoogleRewardedRuntime());
  }

  async boot(app) {
    if (!app || typeof app.make !== "function" || typeof app.has !== "function") {
      throw new Error("GoogleRewardedClientProvider boot requires application make()/has().");
    }

    if (!app.has("jskit.client.vue.app") || typeof document === "undefined") {
      return;
    }

    const vueApp = app.make("jskit.client.vue.app");
    const runtime = app.make("google-rewarded.web.runtime");

    if (vueApp && typeof vueApp.provide === "function") {
      vueApp.provide(GOOGLE_REWARDED_RUNTIME_INJECTION_KEY, runtime);
    }

    this.hostContainer = document.createElement("div");
    this.hostContainer.dataset.jskitGoogleRewardedHost = "true";
    document.body.appendChild(this.hostContainer);

    const vnode = h(GoogleRewardedGateHost, {
      runtime
    });
    vnode.appContext = vueApp?._context || null;
    render(vnode, this.hostContainer);
  }

  shutdown() {
    if (!this.hostContainer) {
      return;
    }

    render(null, this.hostContainer);
    this.hostContainer.remove();
    this.hostContainer = null;
  }
}

export { GoogleRewardedClientProvider };
