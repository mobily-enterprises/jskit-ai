/**
 * Where an application runs, read from one environment variable, `APP_ENV`.
 * Every decision about it reads this module: side effects, the development
 * shortcuts (dev sign-in, relaxed cookies, test databases), the banner and the
 * security headers. NODE_ENV only picks optimised builds; nothing here reads it.
 *
 * - `development`: a developer's machine, a session or a preview. Email, SMS,
 *   push, webhooks and connector writes are logged, not sent; payments use the
 *   sandbox.
 * - `test`: the same, inside automated test runs (`jskit test` and the browser
 *   test servers set it).
 * - `staging`: a copy on a server for checking the application before production. Email goes only to
 *   STAGING_EMAIL_TO and SMS only to STAGING_SMS_TO (logged when unset); the rest
 *   is logged; payments use the sandbox. Development shortcuts are refused. When
 *   real people use it (STAGING_REACHES_REAL_PEOPLE=true, which its host gives),
 *   email and SMS go to the people they are for instead; everything else stays
 *   as staging has it.
 * - `production`: the application serving real people. Everything is real.
 */
const APP_ENV_KEY = "APP_ENV";
const APP_ENVIRONMENTS = Object.freeze(["development", "test", "staging", "production"]);
const STAGING_AND_PRODUCTION = Object.freeze(["staging", "production"]);
// The host's word that real people use this staging server, so its email and SMS reach them. Only staging takes it,
// and only as `true`.
const STAGING_REACHES_REAL_PEOPLE_KEY = "STAGING_REACHES_REAL_PEOPLE";

/**
 * The page's environment travels in this meta tag: the JSKIT server adds it to
 * every HTML page it sends, and JSKIT's Vite plugin to the pages its
 * development server sends, so the shell shows its "Development", "Test" or "Staging"
 * banner with no request and no application code.
 */
const APP_ENVIRONMENT_META_NAME = "jskit-app-environment";
// A staging page that real people use says so in a second tag, right after the first, so the banner can say it too.
const STAGING_REAL_PEOPLE_META_NAME = "jskit-staging-reaches-real-people";
const APP_ENVIRONMENT_META_PATTERN = new RegExp(
  `<meta name="${APP_ENVIRONMENT_META_NAME}" content="[a-z]*">(?:<meta name="${STAGING_REAL_PEOPLE_META_NAME}" content="true">)?`,
  "u"
);
const HEAD_OPENING_PATTERN = /<head(?:\s[^>]*)?>/iu;

/**
 * The application's environment, from the environment's APP_ENV. A missing or
 * unknown value throws, naming the fix: nothing guesses where an application
 * runs.
 * @param {Record<string, string | undefined>} env
 * @returns {"development" | "test" | "staging" | "production"}
 */
function appEnvironment(env) {
  const value = String(env[APP_ENV_KEY] ?? "").trim();
  if (!value) {
    throw new Error(
      `${APP_ENV_KEY} is not set. Set ${APP_ENV_KEY} to development, test, staging or production: development on a ` +
        "developer's machine or in a preview, staging or production (with NODE_ENV=production) on a server."
    );
  }
  if (!APP_ENVIRONMENTS.includes(value)) {
    throw new Error(
      `${APP_ENV_KEY} is "${value}", which is not an environment JSKIT knows. Set ${APP_ENV_KEY} to development, ` +
        "test, staging or production."
    );
  }
  return /** @type {"development" | "test" | "staging" | "production"} */ (value);
}

/**
 * True for staging and production: a server that people outside development reach, which refuses every
 * development shortcut (dev sign-in, cookies without Secure, test databases, development-only settings).
 * @param {Record<string, string | undefined>} env
 */
function isStagingOrProduction(env) {
  return STAGING_AND_PRODUCTION.includes(appEnvironment(env));
}

/**
 * Whether real people use this staging server, so its email and SMS go to the people they are for: true only when
 * STAGING_REACHES_REAL_PEOPLE is `true` and APP_ENV is staging. Unset or empty, it is false. Any other value, or the
 * setting in any other environment, throws, naming the fix: it is the host's word about one staging server, so it
 * never means anything elsewhere, and nothing guesses what another value meant.
 * @param {Record<string, string | undefined>} env
 */
function stagingReachesRealPeople(env) {
  const value = String(env[STAGING_REACHES_REAL_PEOPLE_KEY] ?? "").trim();
  if (!value) {
    return false;
  }
  const environment = appEnvironment(env);
  if (environment !== "staging") {
    throw new Error(
      `${STAGING_REACHES_REAL_PEOPLE_KEY} is set and ${APP_ENV_KEY} is ${environment}. It says real people use a ` +
        `staging server, so only ${APP_ENV_KEY}=staging takes it: remove ${STAGING_REACHES_REAL_PEOPLE_KEY} from the ` +
        `${environment} environment.`
    );
  }
  if (value !== "true") {
    throw new Error(
      `${STAGING_REACHES_REAL_PEOPLE_KEY} is "${value}". Set it to true when real people use this staging server, ` +
        "or leave it unset."
    );
  }
  return true;
}

/**
 * The page with its environment meta tag, first in its head, and after it, on a staging page that real people use,
 * the `jskit-staging-reaches-real-people` tag: a page that has them already gets them replaced, and text with no
 * head is returned unchanged.
 * @param {string} html
 * @param {"development" | "test" | "staging" | "production"} environment
 * @param {{ reachesRealPeople?: boolean }} [options] `stagingReachesRealPeople(env)`'s answer
 */
function withAppEnvironmentMeta(html, environment, { reachesRealPeople = false } = {}) {
  const realPeople = reachesRealPeople === true && environment === "staging"
    ? `<meta name="${STAGING_REAL_PEOPLE_META_NAME}" content="true">`
    : "";
  const tag = `<meta name="${APP_ENVIRONMENT_META_NAME}" content="${environment}">${realPeople}`;
  if (APP_ENVIRONMENT_META_PATTERN.test(html)) {
    return html.replace(APP_ENVIRONMENT_META_PATTERN, tag);
  }
  const opening = HEAD_OPENING_PATTERN.exec(html);
  if (!opening) {
    return html;
  }
  const insertAt = opening.index + opening[0].length;
  return `${html.slice(0, insertAt)}${tag}${html.slice(insertAt)}`;
}

/**
 * The environment of the page this tab loaded, or "" when the page names none (a
 * page no JSKIT server or development server sent, such as one bundled into a
 * mobile app) or outside a browser.
 * @param {Document} [documentObject]
 * @returns {"development" | "test" | "staging" | "production" | ""}
 */
function pageAppEnvironment(documentObject = globalThis.document) {
  // readable-check: allow optional-call - platform object: there is no document outside a browser
  const meta = documentObject?.querySelector(`meta[name="${APP_ENVIRONMENT_META_NAME}"]`);
  const content = String(meta?.getAttribute("content") || "").trim();
  return APP_ENVIRONMENTS.includes(content)
    ? /** @type {"development" | "test" | "staging" | "production"} */ (content)
    : "";
}

/**
 * Whether the page this tab loaded is a staging page that real people use: its environment is staging and it carries
 * the `jskit-staging-reaches-real-people` tag. False outside a browser and on any other page.
 * @param {Document} [documentObject]
 */
function pageStagingReachesRealPeople(documentObject = globalThis.document) {
  // readable-check: allow optional-call - platform object: there is no document outside a browser
  const meta = documentObject?.querySelector(`meta[name="${STAGING_REAL_PEOPLE_META_NAME}"]`);
  return pageAppEnvironment(documentObject) === "staging" && String(meta?.getAttribute("content") || "").trim() === "true";
}

export {
  APP_ENV_KEY,
  APP_ENVIRONMENTS,
  APP_ENVIRONMENT_META_NAME,
  STAGING_REACHES_REAL_PEOPLE_KEY,
  STAGING_REAL_PEOPLE_META_NAME,
  appEnvironment,
  isStagingOrProduction,
  pageAppEnvironment,
  pageStagingReachesRealPeople,
  stagingReachesRealPeople,
  withAppEnvironmentMeta
};
