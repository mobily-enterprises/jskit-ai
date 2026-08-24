import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { h, render } from "vue";
import GoogleRewardedGateHost from "../components/GoogleRewardedGateHost.vue";
import {
  GOOGLE_REWARDED_RUNTIME_INJECTION_KEY,
  createGoogleRewardedRuntime
} from "../runtime/googleRewardedRuntime.js";

const mountedHosts = new WeakMap();

const GoogleRewardedClientProvider = defineProvider({
  id: "google-rewarded.web.client",
  requires: {
    vueApp: "client.vue"
  },
  provides: {
    googleRewarded: "client.google-rewarded"
  },
  setup() {
    return {
      googleRewarded: createGoogleRewardedRuntime()
    };
  },
  async boot({ vueApp }, { outputs }) {
    if (typeof document === "undefined") {
      return;
    }

    const runtime = outputs.googleRewarded;

    if (vueApp && typeof vueApp.provide === "function") {
      vueApp.provide(GOOGLE_REWARDED_RUNTIME_INJECTION_KEY, runtime);
    }

    const hostContainer = document.createElement("div");
    hostContainer.dataset.jskitGoogleRewardedHost = "true";
    document.body.appendChild(hostContainer);

    const vnode = h(GoogleRewardedGateHost, {
      runtime
    });
    vnode.appContext = vueApp?._context || null;
    render(vnode, hostContainer);
    mountedHosts.set(runtime, hostContainer);
  },
  shutdown(_dependencies, { outputs }) {
    const hostContainer = mountedHosts.get(outputs.googleRewarded);
    if (!hostContainer) {
      return;
    }

    render(null, hostContainer);
    hostContainer.remove();
    mountedHosts.delete(outputs.googleRewarded);
  }
});

export { GoogleRewardedClientProvider };
