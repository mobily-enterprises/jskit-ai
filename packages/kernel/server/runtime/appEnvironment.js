import {
  APP_ENV_KEY,
  STAGING_REACHES_REAL_PEOPLE_KEY,
  appEnvironment,
  isStagingOrProduction,
  stagingReachesRealPeople
} from "../../shared/support/appEnvironment.js";

/** @typedef {import("../types.js").RuntimeEnv} RuntimeEnv */
/** @typedef {import("../types.js").RuntimeLogger} RuntimeLogger */
/** @typedef {"development" | "test" | "staging" | "production"} AppEnvironment */

const NODE_ENV_KEY = "NODE_ENV";
// The one address each kind of message goes to in staging; with it unset, staging logs the message.
const STAGING_ADDRESS_KEYS = Object.freeze({ email: "STAGING_EMAIL_TO", sms: "STAGING_SMS_TO" });
// The environment variables JSKIT no longer reads, each with the fix that names what replaced it. While one is set, a
// server refuses to start and test databases are not prepared (`assertNoRetiredVariables`), instead of ignoring it.
const RETIRED_VARIABLES = Object.freeze({
  SIDE_EFFECTS: `SIDE_EFFECTS was replaced by ${APP_ENV_KEY}: remove SIDE_EFFECTS. ` +
    `${APP_ENV_KEY}=production acts for real; staging sends email and SMS only to ${STAGING_ADDRESS_KEYS.email} ` +
    `and ${STAGING_ADDRESS_KEYS.sms}; development and test only log.`,
  PROD_DB_NAME: "PROD_DB_NAME is no longer read: name that database in STAGING_DB_NAME (your Staging database) or " +
    "PRODUCTION_DB_NAME (your Production database).",
  AUTH_LOCAL_FILE_PRODUCTION_ACK: "AUTH_LOCAL_FILE_PRODUCTION_ACK is no longer read: set " +
    "AUTH_LOCAL_FILE_STAGING_OR_PRODUCTION_ACK=true instead, which the local file auth backend needs in staging and " +
    "production."
});
const STAGING_ORIGINAL_TO_HEADER = "X-Staging-Original-To";
const ENVIRONMENT_LABELS = Object.freeze({
  development: "Development",
  test: "Test",
  staging: "Staging",
  production: "Production"
});
const BODY_OPENING_PATTERN = /<body(?:\s[^>]*)?>/iu;

/**
 * Throws, in any environment, while a variable JSKIT no longer reads is set, with the fix for each one set:
 * SIDE_EFFECTS, which APP_ENV replaced; PROD_DB_NAME, which STAGING_DB_NAME and PRODUCTION_DB_NAME replaced; and
 * AUTH_LOCAL_FILE_PRODUCTION_ACK, which AUTH_LOCAL_FILE_STAGING_OR_PRODUCTION_ACK replaced. A server's startup
 * (`assertAppEnvironment`) and every preparation of test databases check it first.
 * @param {RuntimeEnv} env
 */
function assertNoRetiredVariables(env) {
  const fixes = Object.entries(RETIRED_VARIABLES)
    .filter(([name]) => String(env[name] ?? "").trim())
    .map(([, fix]) => fix);
  if (fixes.length > 0) {
    throw new Error(fixes.join(" "));
  }
}

/**
 * Stops a server's startup, naming the fix, unless its environment is one JSKIT knows: no variable JSKIT no longer
 * reads (`assertNoRetiredVariables`); APP_ENV set to development, test, staging or production; NODE_ENV=production
 * in staging and production, where optimised builds run; and STAGING_REACHES_REAL_PEOPLE only as `true` and only in
 * staging (`stagingReachesRealPeople`). `createInstalledRuntime` checks it before anything else.
 * @param {RuntimeEnv} env
 */
function assertAppEnvironment(env) {
  assertNoRetiredVariables(env);
  const environment = appEnvironment(env);
  const nodeEnv = String(env[NODE_ENV_KEY] ?? "").trim();
  if (isStagingOrProduction(env) && nodeEnv !== "production") {
    throw new Error(
      `${APP_ENV_KEY} is ${environment}, so ${NODE_ENV_KEY} must be production, and it is ` +
        `${nodeEnv ? nodeEnv : "not set"}. Set ${NODE_ENV_KEY}=production: it only picks optimised builds, and ` +
        `${APP_ENV_KEY} decides everything else.`
    );
  }
  stagingReachesRealPeople(env);
}

/**
 * Stops a staging or production server's startup when a development-only setting is set, instead of quietly
 * ignoring it, saying what to do.
 * @param {RuntimeEnv} env
 * @param {ReadonlyArray<string>} names The development-only env names.
 */
function assertDevelopmentOnlySettings(env, names) {
  if (!isStagingOrProduction(env)) {
    return;
  }
  const environment = appEnvironment(env);
  const set = names.filter((name) => String(env[name] ?? "").trim() !== "");
  if (set.length > 0) {
    throw new Error(
      `${set.join(", ")} ${set.length === 1 ? "is" : "are"} for development only and ${APP_ENV_KEY} is ` +
        `${environment}. Remove ${set.length === 1 ? "it" : "them"} from the ${environment} environment.`
    );
  }
}

/**
 * Says once, as the application starts, where it runs and what that means for what it sends.
 * @param {RuntimeLogger} logger
 * @param {RuntimeEnv} env
 */
function logAppEnvironment(logger, env) {
  const environment = appEnvironment(env);
  if (environment === "production") {
    logger.info({ appEnv: environment }, "APP_ENV is production: email, SMS, push notifications, webhooks, " +
      "connector writes and payments act for real.");
    return;
  }
  if (environment === "staging" && stagingReachesRealPeople(env)) {
    const ignored = Object.values(STAGING_ADDRESS_KEYS).filter((variable) => String(env[variable] ?? "").trim());
    logger.info({ appEnv: environment, stagingReachesRealPeople: true }, `APP_ENV is staging and real people use it ` +
      `(${STAGING_REACHES_REAL_PEOPLE_KEY}=true): email and SMS go to the people they are for` +
      `${ignored.length > 0 ? ` (${ignored.join(" and ")} ${ignored.length === 1 ? "is" : "are"} not used)` : ""}; ` +
      "push notifications, webhooks and connector writes are logged; payments use the sandbox; development " +
      "shortcuts are refused and pages show a \"Staging · real people\" banner.");
    return;
  }
  if (environment === "staging") {
    const goesTo = (kind) => {
      const variable = STAGING_ADDRESS_KEYS[kind];
      const address = stagingAddress(env, kind);
      return address ? `goes only to ${address} (${variable})` : `is logged (${variable} is not set)`;
    };
    logger.info({ appEnv: environment }, `APP_ENV is staging: email ${goesTo("email")}, SMS ${goesTo("sms")}; ` +
      "push notifications, webhooks and connector writes are logged; payments use the sandbox; development " +
      "shortcuts are refused and pages show a \"Staging\" banner.");
    return;
  }
  logger.info({ appEnv: environment }, `APP_ENV is ${environment}: email, SMS, push notifications, webhooks and ` +
    "connector writes are logged, not sent; payments use the sandbox; pages show a " +
    `"${ENVIRONMENT_LABELS[environment]}" banner.`);
}

/**
 * The address staging sends one kind of message to, or "".
 * @param {RuntimeEnv} env
 * @param {"email" | "sms"} kind
 */
function stagingAddress(env, kind) {
  return String(env[STAGING_ADDRESS_KEYS[kind]] ?? "").trim();
}

/**
 * Writes one side effect the application logged instead of performing outside production (a push notification, a
 * webhook, a connector write), so the person checking it can follow what would have gone out. Every JSKIT package
 * that would have sent something logs through this one line shape. Email and SMS go through `deliverMessage`.
 * @param {RuntimeLogger} logger
 * @param {AppEnvironment} environment The application's environment, from `appEnvironment(env)`.
 * @param {object} effect
 * @param {string} effect.kind What would have gone out, such as "push notification" or "connector operation".
 * @param {string} effect.summary One plain phrase naming it, such as "the reminder to device 4".
 * @param {Record<string, unknown>} [effect.details] What a tester needs to act on it, such as the link it carried.
 * @param {string} [effect.reason] Why staging logged it; "only production acts for real" when omitted.
 */
function logSideEffect(logger, environment, { kind, summary, details = {}, reason = "" }) {
  const because = reason || (environment === "staging" ? "only production acts for real" : "");
  logger.info(
    { appEnv: environment, kind, ...details },
    `${ENVIRONMENT_LABELS[environment]}: ${summary} was logged, not sent${because ? `: ${because}` : ""}.`
  );
}

/**
 * Sends one email or SMS the way APP_ENV says. Production sends it to `to`. Staging sends it to STAGING_EMAIL_TO
 * (SMS: STAGING_SMS_TO) instead, with the original recipient in the log and in `send`'s `originalTo`, or logs it when
 * that variable is unset; a staging server that real people use (STAGING_REACHES_REAL_PEOPLE=true) sends it to `to`,
 * unmarked, and logs that it did. Development and test log it. Every email and SMS JSKIT sends goes through here, and
 * so should the application's own.
 * @template T
 * @param {object} message
 * @param {RuntimeEnv} message.env
 * @param {RuntimeLogger} message.logger
 * @param {"email" | "sms"} message.channel
 * @param {string} message.to The recipient the application meant.
 * @param {string} message.summary One plain phrase naming it, such as "the password reset email to ada@example.com".
 * @param {Record<string, unknown>} [message.details] What a tester needs to act on it, such as the link it carried.
 * @param {(to: string, routing: { originalTo: string }) => Promise<T>} message.send Sends it to `to`; `originalTo`
 *   is the recipient the application meant when staging sent it elsewhere, else "" (production, and a staging server
 *   that real people use). An email shows it (`markStagingEmail`).
 * @returns {Promise<{ sent: false } | { sent: true, to: string, originalTo: string, result: T }>}
 */
async function deliverMessage({ env, logger, channel, to, summary, details = {}, send }) {
  const variable = STAGING_ADDRESS_KEYS[channel];
  if (!variable) {
    throw new TypeError(`deliverMessage sends email or sms, not ${channel}.`);
  }
  const environment = appEnvironment(env);
  if (environment === "production") {
    return { sent: true, to, originalTo: "", result: await send(to, { originalTo: "" }) };
  }
  if (environment === "staging" && stagingReachesRealPeople(env)) {
    const result = await send(to, { originalTo: "" });
    logger.info(
      { appEnv: environment, kind: channel, to, stagingReachesRealPeople: true, ...details },
      `Staging: ${summary} was sent to ${to}, since real people use this staging (${STAGING_REACHES_REAL_PEOPLE_KEY}).`
    );
    return { sent: true, to, originalTo: "", result };
  }
  const address = environment === "staging" ? stagingAddress(env, channel) : "";
  if (!address) {
    const reason = environment === "staging" ? `${variable} is not set` : "";
    logSideEffect(logger, environment, { kind: channel, summary, details: { to, ...details }, reason });
    return { sent: false };
  }
  const result = await send(address, { originalTo: to });
  logger.info(
    { appEnv: environment, kind: channel, to: address, originalTo: to, ...details },
    `Staging: ${summary} was sent to ${address} (${variable}) instead.`
  );
  return { sent: true, to: address, originalTo: to, result };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => `&#${character.charCodeAt(0)};`);
}

/**
 * The email with the recipient the application meant shown, when staging sent it to STAGING_EMAIL_TO: a first line
 * in its text and HTML and the X-Staging-Original-To header. Any other email comes back unchanged.
 * @template {{ text?: string, html?: string, headers?: Record<string, string> }} M
 * @param {M} email
 * @param {string} originalTo `deliverMessage`'s `originalTo`.
 * @returns {M}
 */
function markStagingEmail(email, originalTo) {
  if (!originalTo) {
    return email;
  }
  const note = `Staging: this email was for ${originalTo}.`;
  const marked = { ...email, headers: { ...email.headers, [STAGING_ORIGINAL_TO_HEADER]: originalTo } };
  if (typeof email.text === "string") {
    marked.text = `${note}\n\n${email.text}`;
  }
  if (typeof email.html === "string") {
    const paragraph = `<p>${escapeHtml(note)}</p>`;
    const opening = BODY_OPENING_PATTERN.exec(email.html);
    const insertAt = opening ? opening.index + opening[0].length : 0;
    marked.html = `${email.html.slice(0, insertAt)}${paragraph}${email.html.slice(insertAt)}`;
  }
  return marked;
}

export {
  STAGING_ORIGINAL_TO_HEADER,
  assertAppEnvironment,
  assertDevelopmentOnlySettings,
  assertNoRetiredVariables,
  deliverMessage,
  logAppEnvironment,
  logSideEffect,
  markStagingEmail
};
