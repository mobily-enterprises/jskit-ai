import { spawn } from "node:child_process";
import { mkdtemp, open, realpath, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { validateIntegrationConfiguration } from "@jskit-ai/connectors-core/shared/configuration";
import { wizDefinition } from "../shared/wiz.js";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const failure = (code, message, statusCode = 502) => new ConnectorError(code, message, { statusCode });

// This process belongs to the scanner, not the application's chat/agent runtime.
async function runCli(executable, args, options, signal, timeoutMs) {
  if (signal?.aborted) throw failure("connector_cancelled", "The Wiz scan was cancelled.", 499);
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(executable, args, { ...options, shell: false, detached: true, stdio: "ignore" }); }
    catch { reject(failure("connector_runner_unavailable", "The Wiz CLI could not be started.")); return; }
    let cancelled = false; let timedOut = false; let startFailed = false;
    const kill = () => {
      if (!child.pid) return;
      try { process.kill(-child.pid, "SIGKILL"); } catch (error) {
        if (error.code !== "ESRCH") child.kill("SIGKILL");
      }
    };
    const abort = () => { cancelled = true; kill(); };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.once("error", () => { startFailed = true; });
    // Wait for close before deleting reports/cache, including after cancellation.
    child.once("close", (exitCode) => {
      clearTimeout(timer); signal?.removeEventListener("abort", abort); kill();
      if (cancelled) reject(failure("connector_cancelled", "The Wiz scan was cancelled.", 499));
      else if (timedOut) reject(failure("connector_timeout", "The Wiz scan exceeded its time limit.", 504));
      else if (startFailed) reject(failure("connector_runner_unavailable", "The Wiz CLI could not be started."));
      else resolve(exitCode);
    });
  });
}

function createWizScanner({ configuration, authorize, resolveReference, resolveScanTarget, executable,
  environment = { PATH: process.env.PATH || "/usr/bin:/bin" }, timeoutMs = 600_000, maxReportBytes = 16 * 1024 * 1024 }) {
  if (!["linux", "darwin"].includes(process.platform)) throw new TypeError("Run Wiz in a Linux or macOS scan worker.");
  if (typeof executable !== "string" || !path.isAbsolute(executable) || executable.includes("\0")) throw new TypeError("Supply the installed Wiz CLI's absolute path.");
  if (![authorize, resolveReference, resolveScanTarget].every((value) => typeof value === "function")) throw new TypeError("Wiz requires host authorization, secret resolution and source resolution.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) throw new TypeError("Use a scan timeout between 1 and 3600000 milliseconds.");
  if (!Number.isSafeInteger(maxReportBytes) || maxReportBytes < 1 || maxReportBytes > 64 * 1024 * 1024) throw new TypeError("Use a positive report limit of at most 64 MiB.");
  const env = {};
  for (const [key, value] of Object.entries(environment)) {
    if (!["PATH", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR"].includes(key) || typeof value !== "string" || value.includes("\0")) {
      throw new TypeError("Supply only the scan worker's path, proxy and CA environment.");
    }
    env[key] = value;
  }
  const config = validateIntegrationConfiguration(configuration, { providers: [wizDefinition], allowUnknownProviders: true });

  async function scan({ context, integrationId, signal }) {
    const integration = Object.hasOwn(config.integrations, integrationId) ? config.integrations[integrationId] : null;
    if (integration?.provider !== "wiz") throw failure("connector_not_found", "This Wiz integration is not configured.", 404);
    const owner = await authorize(context, { integrationId, operation: "source.scan", accountMode: "shared" });
    if (!owner?.applicationId || !owner?.subjectId) throw failure("connector_access_denied", "Access to this source scan was denied.", 403);
    const registration = config.registrations[integration.authentication.registrationRef];
    if (integration.settings.tokenUrl !== "https://auth.app.wiz.io/oauth/token") {
      throw failure("connector_authentication_unsupported", "Auth0 scanning requires a verified compatible Wiz runner.", 501);
    }
    if (signal?.aborted) throw failure("connector_cancelled", "The Wiz scan was cancelled.", 499);
    // The browser supplies no filesystem path. The trusted host selects an immutable
    // source snapshot and revision after checking the requesting principal's access.
    const target = await resolveScanTarget({ ...owner }, { integrationId, signal });
    if (!object(target) || typeof target.directory !== "string" || !path.isAbsolute(target.directory) ||
      target.directory.includes("\0") || typeof target.revision !== "string" || !target.revision.trim() || target.revision.length > 512) {
      throw failure("connector_source_invalid", "The host must supply an absolute source directory and revision.", 422);
    }
    let directory;
    try { directory = await realpath(target.directory); if (!(await stat(directory)).isDirectory()) throw new Error(); }
    catch { throw failure("connector_source_unavailable", "The authorised source directory is unavailable.", 422); }
    let secret;
    try { secret = await resolveReference(registration.clientSecretRef, { ...owner }); }
    catch { throw failure("connector_binding_missing", "The Wiz client-secret reference is unavailable.", 422); }
    if (typeof secret !== "string" || !secret.trim() || secret.includes("\0") || secret.length > 16384) {
      throw failure("connector_binding_missing", "The Wiz client-secret reference is invalid.", 422);
    }
    const temporary = await mkdtemp(path.join(tmpdir(), "jskit-wiz-"));
    try {
      const reportPath = path.join(temporary, "report.json");
      const args = ["scan", "dir", directory, "--assist-migration", "--no-style", "--no-color", "--no-telemetry", "--stdout=human",
        `--json-output-file=${reportPath}`, `--timeout=${Math.ceil(timeoutMs / 1000)}s`, `--by-policy-hits=${integration.settings.byPolicyHits}`];
      if (integration.settings.policies) args.push(`--policies=${integration.settings.policies.split(",").map((item) => item.trim()).join(",")}`);
      const exitCode = await runCli(executable, args, { cwd: temporary,
        env: { ...env, HOME: temporary, TMPDIR: temporary, WIZ_DIR: temporary, WIZ_CLIENT_ID: registration.clientId, WIZ_CLIENT_SECRET: secret }
      }, signal, timeoutMs);
      if (exitCode === 3) throw failure("connector_authentication_failed", "Wiz rejected the service-account credentials.", 401);
      if (exitCode !== 0 && exitCode !== 4) throw failure("connector_scan_failed", "Wiz could not complete the scan. Check the runner, policies and tenant access.");
      let report;
      try {
        const file = await open(reportPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const info = await file.stat();
          if (!info.isFile() || info.size > maxReportBytes) throw new Error();
          report = JSON.parse(await file.readFile("utf8"));
        } finally { await file.close(); }
      } catch { throw failure("connector_response_invalid", "Wiz did not produce a readable report within the configured size limit."); }
      const verdict = report?.status?.verdict;
      if (!object(report) || report.status?.state !== "SUCCESS" || !object(report.result) || !["PASSED_BY_POLICY", "WARN_BY_POLICY", "FAILED_BY_POLICY"].includes(verdict) ||
        (exitCode === 4 && verdict !== "FAILED_BY_POLICY")) {
        throw failure("connector_response_invalid", "Wiz returned an unsupported or inconsistent scan report.");
      }
      return { provider: "wiz", integrationId, revision: target.revision,
        policyStatus: verdict === "FAILED_BY_POLICY" ? "blocked" : verdict === "WARN_BY_POLICY" ? "warning" : "passed", report };
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  return Object.freeze({ scan });
}

export { createWizScanner };
