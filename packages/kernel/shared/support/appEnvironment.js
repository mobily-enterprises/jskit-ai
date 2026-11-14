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
 * - `staging`: a deployed copy for checking the application. Email goes only to
 *   STAGING_EMAIL_TO and SMS only to STAGING_SMS_TO (logged when unset); the rest
 *   is logged; payments use the sandbox. Development shortcuts are refused.
 * - `production`: the application serving real people. Everything is real.
 */
const APP_ENV_KEY = "APP_ENV";
const APP_ENVIRONMENTS = Object.freeze(["development", "test", "staging", "production"]);
const DEPLOYED_ENVIRONMENTS = Object.freeze(["staging", "production"]);

/**
 * The page's environment travels in this meta tag: the JSKIT server adds it to
 * every HTML page it sends, and JSKIT's Vite plugin to the pages its
 * development server sends, so the shell shows its "Development", "Test" or "Staging"
 * banner with no request and no application code.
 */
const APP_ENVIRONMENT_META_NAME = "jskit-app-environment";
const APP_ENVIRONMENT_META_PATTERN = new RegExp(`<meta name="${APP_ENVIRONMENT_META_NAME}" content="[a-z]*">`, "u");
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
function isDeployed(env) {
  return DEPLOYED_ENVIRONMENTS.includes(appEnvironment(env));
}

/**
 * The page with its environment meta tag, first in its head: a page that has
 * one already gets it replaced, and text with no head is returned unchanged.
 * @param {string} html
 * @param {"development" | "test" | "staging" | "production"} environment
 */
function withAppEnvironmentMeta(html, environment) {
  const tag = `<meta name="${APP_ENVIRONMENT_META_NAME}" content="${environment}">`;
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

export {
  APP_ENV_KEY,
  APP_ENVIRONMENTS,
  APP_ENVIRONMENT_META_NAME,
  appEnvironment,
  isDeployed,
  pageAppEnvironment,
  withAppEnvironmentMeta
};
