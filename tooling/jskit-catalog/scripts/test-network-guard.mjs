// Red stub: the test network guard is not written yet.
const NETWORK_REFUSED_CODE = "JSKIT_TEST_NETWORK_REFUSED";
const NETWORK_GUARD_VARIABLE = "JSKIT_TEST_NETWORK_GUARD";
const NETWORK_GUARD_PRELOAD = new URL("./test-network-guard-preload.mjs", import.meta.url).href;

const isAllowedTestHost = () => true;
const networkGuardEnvironment = (env) => ({ NODE_OPTIONS: env.NODE_OPTIONS || "" });
const withoutNetworkGuard = (nodeOptions) => String(nodeOptions || "");
function installNetworkGuard() {}

export {
  NETWORK_GUARD_PRELOAD,
  NETWORK_GUARD_VARIABLE,
  NETWORK_REFUSED_CODE,
  installNetworkGuard,
  isAllowedTestHost,
  networkGuardEnvironment,
  withoutNetworkGuard
};
