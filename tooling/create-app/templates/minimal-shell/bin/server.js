import { startServer } from "../server.js";

try {
  await startServer();
} catch (error) {
  console.error("Failed to start __APP_NAME__ server:", error);
  process.exitCode = 1;
}
