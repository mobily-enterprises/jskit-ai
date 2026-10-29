import { readServedClientBuildId } from "@jskit-ai/kernel/server/support";
import { SERVED_CLIENT_BUILD_EVENT } from "../shared/servedClientBuild.js";

// Each connection, including a reconnection to a restarted server, learns the
// client build this server serves now. A page running an older build can then
// offer a reload without polling.
function announceServedClientBuild({ io, appRoot, logger }) {
  if (!appRoot || typeof io?.on !== "function") return;
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
