import { MobileCapacitorClientProvider } from "./providers/MobileCapacitorClientProvider.js";

export { MobileCapacitorClientProvider } from "./providers/MobileCapacitorClientProvider.js";
export { createMobileCapacitorRuntime } from "./runtime/mobileCapacitorRuntime.js";
export {
  createGlobalCapacitorAppAdapter,
  createNoopCapacitorAppAdapter,
  resolveCapacitorAppPlugin
} from "./runtime/globalCapacitorAppAdapter.js";

const clientProviders = Object.freeze([MobileCapacitorClientProvider]);

export { clientProviders };
