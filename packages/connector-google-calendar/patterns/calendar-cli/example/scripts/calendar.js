import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import createKnex from "knex";
import { parseIntegrationConfiguration } from "@jskit-ai/connectors-core/shared/configuration";
import { createConnectionService, createEnvironmentReferenceResolver } from "@jskit-ai/connectors-core/server";
import { createCredentialProtection, createKnexConnectionStore } from "@jskit-ai/connectors-core/server/storage";
import { googleCalendarProvider } from "@jskit-ai/connector-google-calendar/server";

// A local operator command owns this HTTP listener; web apps use authenticated routes.
async function connectInBrowser(service, context) {
  const callback = new URL(process.env.GOOGLE_CALLBACK_URL);
  if (callback.protocol !== "http:" || callback.hostname !== "127.0.0.1" || !callback.port) {
    throw new Error("This CLI requires a registered http://127.0.0.1:PORT callback.");
  }
  let state;
  let finish;
  let fail;
  let completed = false;
  const controller = new AbortController();
  const finished = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  const outcome = finished.then((result) => ({ result }), (error) => ({ error }));
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, callback.origin);
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "GET" || url.pathname !== callback.pathname || !state || url.searchParams.get("state") !== state) {
      response.writeHead(400).end("This is not the pending authorization callback.");
      return;
    }
    try {
      const result = await service.completeAuthorization({ context, integrationId: "calendar", callbackUrl: url.href, signal: controller.signal });
      completed = true;
      response.end("Connected. You can close this window.");
      finish(result);
    } catch (error) {
      response.writeHead(400).end("Connection failed. Return to the terminal.");
      fail(error);
    }
  });
  server.listen(Number(callback.port), "127.0.0.1");
  await once(server, "listening");
  const cancel = () => { controller.abort(); fail(new Error("Authorization cancelled.")); };
  process.once("SIGINT", cancel);
  const timeout = setTimeout(cancel, 10 * 60 * 1000);
  try {
    const start = await service.beginAuthorization({ context, integrationId: "calendar", signal: controller.signal });
    state = new URL(start.authorizationUrl).searchParams.get("state");
    console.log(`Open this URL in your browser:\n${start.authorizationUrl}`);
    const completed = await outcome;
    if (completed.error) throw completed.error;
    return completed.result;
  } finally {
    clearTimeout(timeout);
    process.off("SIGINT", cancel);
    try {
      if (state && !completed) await service.cancelAuthorization({ context, integrationId: "calendar", state });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

async function main() {
  const command = process.argv[2] || "validate";
  const configuration = parseIntegrationConfiguration(await readFile("integrations.json", "utf8"), { providers: [googleCalendarProvider] });
  if (command === "validate") {
    console.log("Integration configuration is valid.");
    return;
  }
  if (!["connect", "status", "calendars", "events", "disconnect"].includes(command)) {
    throw new Error("Use validate, connect, status, calendars, events or disconnect.");
  }
  for (const name of ["DATABASE_URL", "CONNECTOR_STORAGE_KEY", "CONNECTOR_APPLICATION_ID", "CONNECTOR_SUBJECT_ID"]) {
    if (!process.env[name]) throw new Error(`Set ${name} before using connections.`);
  }
  const context = { applicationId: process.env.CONNECTOR_APPLICATION_ID, subjectId: process.env.CONNECTOR_SUBJECT_ID };
  const protection = createCredentialProtection({ keys: { current: Buffer.from(process.env.CONNECTOR_STORAGE_KEY, "base64") }, activeKeyId: "current" });
  const knex = createKnex({ client: "mysql2", connection: process.env.DATABASE_URL });
  try {
    const service = createConnectionService({
      configuration, providers: [googleCalendarProvider],
      store: createKnexConnectionStore({ knex, protection }),
      resolveReference: createEnvironmentReferenceResolver(process.env),
      authorize: async () => context
    });
    const request = { context, integrationId: "calendar" };
    let result;
    if (command === "connect") result = await connectInBrowser(service, context);
    else if (command === "status") result = await service.status(request);
    else if (command === "disconnect") result = await service.disconnect(request);
    else result = await service.invoke({ ...request, operation: command === "events" ? "events.list" : "calendars.list", input: JSON.parse(process.argv[3] || "{}") });
    console.log(JSON.stringify(result, null, 2));
  } finally { await knex.destroy(); }
}

main().catch((error) => {
  console.error(error.code || "calendar_command_failed");
  if (error.fieldErrors) console.error(JSON.stringify(error.fieldErrors));
  else if (!error.code) console.error(error.message);
  process.exitCode = 1;
});
