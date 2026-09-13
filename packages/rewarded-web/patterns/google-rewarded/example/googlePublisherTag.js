let gptLoadPromise = null;
let gptServicesEnabled = false;

async function ensureGooglePublisherTagLoaded() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Rewarded runtime requires a browser environment.");
  }

  if (window.googletag?.apiReady === true) {
    return window.googletag;
  }
  if (gptLoadPromise) {
    return gptLoadPromise;
  }

  window.googletag ||= { cmd: [] };
  gptLoadPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[data-jskit-rewarded-gpt="true"]');
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(window.googletag), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Failed to load Google Publisher Tag.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://securepubads.g.doubleclick.net/tag/js/gpt.js";
    script.dataset.jskitRewardedGpt = "true";
    script.addEventListener("load", () => resolve(window.googletag), { once: true });
    script.addEventListener("error", () => reject(new Error("Failed to load Google Publisher Tag.")), { once: true });
    document.head.appendChild(script);
  }).catch((error) => {
    gptLoadPromise = null;
    throw error;
  });

  return gptLoadPromise;
}

function launchGoogleRewardedAd({
  providerConfig,
  onReady = null,
  onGranted = null,
  onClosed = null,
  onUnavailable = null
} = {}) {
  if (providerConfig?.provider !== "google-publisher-tag") {
    throw new TypeError("Google delivery requires provider google-publisher-tag.");
  }
  const placement = String(providerConfig?.placement || "").trim();
  if (!placement) throw new TypeError("Rewarded delivery requires placement.");
  return ensureGooglePublisherTagLoaded().then((googletag) =>
    new Promise((resolve, reject) => {
      googletag.cmd.push(() => {
        const pubads = googletag.pubads();
        const rewardedFormat = googletag?.enums?.OutOfPageFormat?.REWARDED;
        if (!rewardedFormat) {
          reject(new Error("Rewarded ads are not supported by this GPT build."));
          return;
        }

        const slot = googletag.defineOutOfPageSlot(placement, rewardedFormat);
        if (!slot) {
          Promise.resolve(onUnavailable?.()).finally(() => {
            reject(new Error("Rewarded ads are not available on this page."));
          });
          return;
        }

        let readySeen = false;
        let settled = false;

        const cleanup = () => {
          if (typeof pubads.removeEventListener === "function") {
            pubads.removeEventListener("rewardedSlotReady", handleReady);
            pubads.removeEventListener("rewardedSlotGranted", handleGranted);
            pubads.removeEventListener("rewardedSlotClosed", handleClosed);
          }
          if (typeof googletag.destroySlots === "function") {
            googletag.destroySlots([slot]);
          }
        };

        const handleReady = async (event) => {
          if (event?.slot !== slot || settled) {
            return;
          }
          readySeen = true;
          await Promise.resolve(onReady?.());
          if (typeof event.makeRewardedVisible === "function") {
            event.makeRewardedVisible();
          }
        };

        const handleGranted = async (event) => {
          if (event?.slot !== slot || settled) {
            return;
          }
          await Promise.resolve(onGranted?.());
        };

        const handleClosed = async (event) => {
          if (event?.slot !== slot || settled) {
            return;
          }
          settled = true;
          cleanup();
          try {
            await Promise.resolve(onClosed?.());
            resolve();
          } catch (error) {
            reject(error);
          }
        };

        pubads.addEventListener("rewardedSlotReady", handleReady);
        pubads.addEventListener("rewardedSlotGranted", handleGranted);
        pubads.addEventListener("rewardedSlotClosed", handleClosed);
        slot.addService(pubads);

        if (!gptServicesEnabled) {
          googletag.enableServices();
          gptServicesEnabled = true;
        }

        googletag.display(slot);
        window.setTimeout(() => {
          if (settled || readySeen) {
            return;
          }
          settled = true;
          cleanup();
          Promise.resolve(onUnavailable?.()).finally(() => {
            reject(new Error("No rewarded ad was available."));
          });
        }, 10000);
      });
    })
  );
}

export { launchGoogleRewardedAd };
