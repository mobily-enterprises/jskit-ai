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
  /** @param {{ delivery: import("../types.js").RewardedDelivery }} capabilities */
  setup({ delivery }) {
    return {
      rewarded: createRewardedRuntime({ launchReward: delivery.launchReward })
    };
  },
  /**
   * @param {{ vueApp: import("@jskit-ai/kernel/client/types").ClientVueApp }} capabilities
   * @param {{ outputs: { rewarded: import("../types.js").RewardedRuntime } }} context
   */
  async boot({ vueApp }, { outputs }) {
    if (typeof document === "undefined") {
      return;
    }

    const runtime = outputs.rewarded;

    vueApp.provide(REWARDED_RUNTIME_INJECTION_KEY, runtime);

    const hostContainer = document.createElement("div");
    hostContainer.dataset.jskitRewardedHost = "true";
    document.body.appendChild(hostContainer);

    const vnode = h(RewardedGateHost, {
      runtime
    });
    vnode.appContext = vueApp._context;
    render(vnode, hostContainer);
    mountedHosts.set(runtime, hostContainer);
  },
  /**
   * @param {object} _capabilities
   * @param {{ outputs: { rewarded: import("../types.js").RewardedRuntime } }} context
   */
  shutdown(_capabilities, { outputs }) {
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
