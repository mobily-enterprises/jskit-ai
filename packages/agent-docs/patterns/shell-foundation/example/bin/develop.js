import { spawn } from "node:child_process";
import { startServer } from "../server.js";

const LOOPBACK_HOST = "127.0.0.1";

function requiredPort(value, fallback = 3000) {
  const normalized = String(value || "").trim();
  const parsed = Number.parseInt(normalized || String(fallback), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`Invalid development port: ${normalized || "(empty)"}.`);
  }
  return parsed;
}

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

const previewHost = String(process.env.HOST || "").trim() || "0.0.0.0";
const previewPort = requiredPort(process.env.PORT);
let apiServer = null;
let viteProcess = null;
let requestedSignal = "";

function requestShutdown(signal) {
  requestedSignal = signal;
  if (viteProcess && !viteProcess.killed) {
    viteProcess.kill(signal);
  }
}

process.once("SIGINT", () => requestShutdown("SIGINT"));
process.once("SIGTERM", () => requestShutdown("SIGTERM"));

try {
  apiServer = await startServer({ host: LOOPBACK_HOST, port: 0 });
  const apiPort = requiredPort(apiServer.server.address()?.port);
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  viteProcess = spawn(
    npmCommand,
    ["run", "dev", "--", "--host", previewHost, "--port", String(previewPort), "--strictPort"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOST: previewHost,
        PORT: String(previewPort),
        VITE_API_PROXY_TARGET: `http://${LOOPBACK_HOST}:${apiPort}`,
        VITE_DEV_PORT: String(previewPort)
      },
      stdio: "inherit"
    }
  );

  const result = await waitForChild(viteProcess);
  if (!requestedSignal && result.code !== 0) {
    throw new Error(
      `Vite development server stopped unexpectedly (${result.signal || `exit ${result.code ?? "unknown"}`}).`
    );
  }
} catch (error) {
  console.error("Failed to start the development application:", error);
  process.exitCode = 1;
} finally {
  if (apiServer) {
    await apiServer.close().catch(() => {});
  }
}
