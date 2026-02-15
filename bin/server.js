import { registerSignalHandlers, startServer } from "../server.js";

registerSignalHandlers();

try {
  await startServer();
} catch (error) {
  console.error("Failed to initialize server:", error);
  process.exit(1);
}
