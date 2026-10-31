import { readServedClientBuildId } from "@jskit-ai/kernel/server/support";
import { SERVED_CLIENT_BUILD_EVENT } from "../shared/servedClientBuild.js";

/**
 * Each connection, including a reconnection to a restarted server, learns the
 * client build this server serves now. A page running an older build can then
 * offer a reload without polling.
 * @param {object} dependencies
 * @param {import("socket.io").Server} dependencies.io
 * @param {import("@jskit-ai/kernel/server/types").RuntimeAppRoot | null} dependencies.appRoot Absent when no runtime.app-root is installed.
 * @param {import("@jskit-ai/kernel/shared/support/providerLogger").ProviderLogger} dependencies.logger
 */
function announceServedClientBuild({ io, appRoot, logger }) {
  if (!appRoot) return;
  io.on("connection", async (socket) => {
    try {
      const buildId = await readServedClientBuildId({ appRoot });
      if (buildId && socket.connected) socket.emit(SERVED_CLIENT_BUILD_EVENT, { buildId });
    } catch (error) {
      logger.warn({ error: String(error?.message || error) }, "Realtime could not read the served client build.");
    }
  });
}

export { announceServedClientBuild };
