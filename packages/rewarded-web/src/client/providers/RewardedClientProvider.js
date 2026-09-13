import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { h, render } from "vue";
import RewardedGateHost from "../components/RewardedGateHost.vue";
import {
  REWARDED_RUNTIME_INJECTION_KEY,
  createRewardedRuntime
} from "../runtime/rewardedRuntime.js";


const mountedHosts = new WeakMap();

const RewardedClientProvider = defineProvider({
  id: "rewarded.web.client",
  requires: {
    vueApp: "client.vue",
    delivery: "client.rewarded-delivery"
  },
  provides: {
    rewarded: "client.rewarded"
  },
  setup({ delivery }) {
    return {
      rewarded: createRewardedRuntime({ launchReward: delivery.launchReward })
    };
  },
  async boot({ vueApp }, { outputs }) {
    if (typeof document === "undefined") {
      return;
    }

    const runtime = outputs.rewarded;

    if (vueApp && typeof vueApp.provide === "function") {
      vueApp.provide(REWARDED_RUNTIME_INJECTION_KEY, runtime);
    }

    const hostContainer = document.createElement("div");
    hostContainer.dataset.jskitRewardedHost = "true";
    document.body.appendChild(hostContainer);

    const vnode = h(RewardedGateHost, {
      runtime
    });
    vnode.appContext = vueApp?._context || null;
    render(vnode, hostContainer);
    mountedHosts.set(runtime, hostContainer);
  },
  shutdown(_dependencies, { outputs }) {
    const hostContainer = mountedHosts.get(outputs.rewarded);
    if (!hostContainer) {
      return;
    }

    render(null, hostContainer);
    hostContainer.remove();
    mountedHosts.delete(outputs.rewarded);
  }
});

export { RewardedClientProvider };
