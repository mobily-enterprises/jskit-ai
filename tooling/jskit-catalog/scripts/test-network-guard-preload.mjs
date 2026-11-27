// Preloaded through NODE_OPTIONS (`--import`) into every process `jskit test` and the browser test servers start, and
// so into the processes those start with the same environment: guards its outbound connections (test-network-guard.mjs).
import { installNetworkGuard } from "./test-network-guard.mjs";

installNetworkGuard();
