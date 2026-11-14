import { createAppEnvironmentBannerRuntime } from "../../../src/client/appEnvironment/appEnvironmentBanner.js";

// A control stretched across the top of the page, where the banner hangs, counts the presses that reach it.
const button = document.getElementById("under-banner");
Object.assign(button.style, { position: "fixed", inset: "0 0 auto 0", height: "48px", width: "100%" });
let presses = 0;
button.addEventListener("click", () => {
  presses += 1;
  button.textContent = `Pressed ${presses} times`;
});

createAppEnvironmentBannerRuntime().install();
document.documentElement.dataset.ready = "true";
