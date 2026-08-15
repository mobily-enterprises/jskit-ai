export {
  MobileCapacitorClientProvider,
  MobileCapacitorRuntimeProvider
} from "./providers/MobileCapacitorClientProvider.js";
export { createMobileCapacitorRuntime } from "./runtime/mobileCapacitorRuntime.js";
export {
  createGlobalCapacitorAppAdapter,
  createNoopCapacitorAppAdapter,
  resolveCapacitorAppPlugin
} from "./runtime/globalCapacitorAppAdapter.js";
