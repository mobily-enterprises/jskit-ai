import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { launchGoogleRewardedAd } from "./googlePublisherTag.js";

const GoogleRewardedDeliveryProvider = defineProvider({
  id: "app.rewarded.google",
  provides: { delivery: "client.rewarded-delivery" },
  setup() {
    return { delivery: Object.freeze({ launchReward: launchGoogleRewardedAd }) };
  }
});

export { GoogleRewardedDeliveryProvider };
