import { AccountError, isEmail, normalizeEmail } from "./accounts.js";
import { DEV_AUTH_SECRET_HEADER } from "./config.js";
import { constantEquals, randomToken } from "./crypto.js";
import { HubError, appendCookie, clientIp, parseCookies, serializeCookie } from "./http.js";
import { hubSessionCookieName } from "./hubSessions.js";
import { HUB_ERRORS, errorBody, hubError } from "./hubErrors.js";
import { composeMessage } from "./mailer.js";
import { ACTIVE_STATUSES, HUB_SCOPES } from "./oidcProvider.js";

const GOOGLE_STATE_COOKIE = "hub_google_state";
const GOOGLE_LINK_COOKIE = "hub_google_link";
const GOOGLE_LINK_KIND = "GoogleLink";
const GOOGLE_LINK_TTL_SECONDS = 600;
/** The locale an API request's emails go out in: the browser's Accept-Language, then English. */
function requestLocale(texts, request) {
  return texts.localeFor({ acceptLanguage: request.headers["accept-language"] });
}

function accountView(account) {
  return {
    id: account.id,
    email: account.email,
    emailVerified: account.emailVerified,
    displayName: account.displayName,
    hasPassword: account.hasPassword,
    googleLinked: account.googleLinked
  };
}

function appView(row) {
  return {
    clientId: row.client_id,
    name: row.client_name,
    origin: row.origin,
    status: row.status,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    lastUsedAt: row.last_used_at
  };
}

function isLoopbackRequest(request) {
  const ip = String(request.socket?.remoteAddress || "").replace(/^::ffff:/u, "");
  return ip === "::1" || ip.startsWith("127.");
}

/** @typedef {ReturnType<typeof createHubRouteSupport>} HubRouteSupport */

/**
 * What every route group shares: the hub session cookie and who it signs in,
 * the owner check, the hub's emails and its rate limits.
 * @param {import("./types.js").Hub} hub
 */
function createHubRouteSupport(hub) {
  const { config, accounts, sessions, rateLimiter, mailer, texts } = hub;
  const sessionCookie = hubSessionCookieName(config);
  const hubHost = new URL(config.issuer).host;

  function cookies(request) {
    return parseCookies(request.headers.cookie);
  }

  function writeCookie(reply, name, value, maxAge) {
    appendCookie(reply, serializeCookie(name, value, { maxAge, secure: config.secure }));
  }

  async function current(request) {
    const session = await sessions.find(cookies(request)[sessionCookie]);
    if (!session) return null;
    const account = await accounts.findById(session.accountId);
    if (!account || account.disabled) return null;
    return { session, account };
  }

  async function requireAccount(request) {
    const signedIn = await current(request);
    if (!signedIn) throw hubError(HUB_ERRORS.signInRequired);
    return signedIn;
  }

  function isOwner(account) {
    return account.emailVerified && account.email === config.ownerEmail;
  }

  async function requireOwner(request) {
    const signedIn = await requireAccount(request);
    if (!isOwner(signedIn.account)) {
      throw hubError(HUB_ERRORS.ownerRequired);
    }
    return signedIn;
  }

  async function signIn(request, reply, account, method) {
    await sessions.destroyToken(cookies(request)[sessionCookie]);
    const token = await sessions.create(account.id, { userAgent: request.headers["user-agent"], method });
    writeCookie(reply, sessionCookie, token, sessions.ttlSeconds);
  }

  /**
   * Sends one of the hub's emails in the language of the request that asked for
   * it (hub accounts keep no saved language).
   */
  async function sendEmail(request, account, purpose, token) {
    const locale = requestLocale(texts, request);
    const t = (key, params) => texts.t(locale, key, params);
    const link = (path) => `${config.issuer}${path}?token=${encodeURIComponent(token)}`;
    const messages = {
      confirm: {
        subject: t("jskit.accounts.mail.confirm.subject"),
        heading: t("jskit.accounts.mail.confirm.heading"),
        body: t("jskit.accounts.mail.confirm.body", { email: account.email }),
        actionLabel: t("jskit.accounts.mail.confirm.action"),
        actionUrl: link("/auth/confirm-email")
      },
      recovery: {
        subject: t("jskit.accounts.mail.recovery.subject"),
        heading: t("jskit.accounts.mail.recovery.heading"),
        body: t("jskit.accounts.mail.recovery.body"),
        actionLabel: t("jskit.accounts.mail.recovery.action"),
        actionUrl: link("/auth/reset-password")
      },
      "google-link": {
        subject: t("jskit.accounts.mail.googleLink.subject"),
        heading: t("jskit.accounts.mail.googleLink.heading"),
        body: t("jskit.accounts.mail.googleLink.body"),
        actionLabel: t("jskit.accounts.mail.googleLink.action"),
        actionUrl: link("/auth/connect-google")
      }
    };
    const { subject, ...content } = messages[purpose];
    await mailer.send({
      to: account.email,
      subject,
      ...composeMessage({ ...content, footer: t("jskit.accounts.mail.footer", { host: hubHost }) })
    });
  }

  /** Ends the account's hub and app sessions everywhere, including apps' own sessions through back-channel logout. */
  async function endEverySession(accountId) {
    await sessions.destroyAllForAccount(accountId);
    await hub.backchannelLogout(accountId);
  }

  async function guardSignInRate(request) {
    if (!(await rateLimiter.signIn(clientIp(request)))) throw hubError(HUB_ERRORS.tooManyAttempts);
  }

  async function guardEmailRate(request, email) {
    if (!(await rateLimiter.email(email, clientIp(request)))) throw hubError(HUB_ERRORS.tooManyAttempts);
  }

  return Object.freeze({
    sessionCookie,
    hubHost,
    cookies,
    writeCookie,
    current,
    requireAccount,
    isOwner,
    requireOwner,
    signIn,
    sendEmail,
    endEverySession,
    guardSignInRate,
    guardEmailRate
  });
}

/**
 * Interactions: an app's sign-in passing through the hub.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeFastify} app
 * @param {import("./types.js").Hub} hub
 * @param {HubRouteSupport} support
 */
function registerInteractionRoutes(app, hub, support) {
  const { clients } = hub;
  const { current, requireAccount } = support;

  async function loadInteraction(request, reply) {
    let details;
    try {
      details = await hub.oidcProvider().interactionDetails(request.raw, reply.raw);
    } catch {
      details = null;
    }
    if (!details || details.uid !== request.params.uid) {
      throw hubError(HUB_ERRORS.interactionExpired);
    }
    const appRow = await clients.get(details.params.client_id);
    return { details, appRow };
  }

  async function finishInteraction(request, reply, account) {
    const { details, appRow } = await loadInteraction(request, reply);
    if (!appRow || !ACTIVE_STATUSES.has(appRow.status)) throw hubError(HUB_ERRORS.appPending);
    // Apps trust the email they receive (invitations, for example), so an
    // address nobody has confirmed never reaches them.
    if (!account.emailVerified) throw hubError(HUB_ERRORS.emailUnconfirmed);
    let result = { login: { accountId: account.id } };
    if (details.prompt.name === "consent" && details.session?.accountId === account.id) {
      const grant = new hub.oidcProvider().Grant({ accountId: account.id, clientId: appRow.client_id });
      grant.addOIDCScope(HUB_SCOPES);
      result = { consent: { grantId: await grant.save() } };
    }
    const redirectTo = await hub.oidcProvider().interactionResult(request.raw, reply.raw, result);
    return { redirectTo };
  }

  function signInPage(uid) {
    return `/auth/sign-in?interaction=${encodeURIComponent(uid)}`;
  }

  app.get("/hub/interaction/:uid", async (request, reply) => {
    return reply.redirect(signInPage(request.params.uid), 303);
  });

  app.get("/hub/interaction/:uid/details", async (request, reply) => {
    const { details, appRow } = await loadInteraction(request, reply);
    const signedIn = await current(request);
    return {
      app: appRow ? { name: appRow.client_name, origin: appRow.origin, status: appRow.status } : null,
      account: signedIn ? accountView(signedIn.account) : null,
      google: Boolean(hub.google),
      // The app's ui_locales, then the browser's Accept-Language: the language
      // the hub's pages show this sign-in in.
      locale: hub.texts.localeFor({ uiLocales: details.params.ui_locales, acceptLanguage: request.headers["accept-language"] })
    };
  });

  app.post("/hub/interaction/:uid/continue", async (request, reply) => {
    const { account } = await requireAccount(request);
    return finishInteraction(request, reply, account);
  });

  app.post("/hub/interaction/:uid/cancel", async (request, reply) => {
    await loadInteraction(request, reply);
    const redirectTo = await hub.oidcProvider().interactionResult(request.raw, reply.raw, {
      error: "access_denied",
      error_description: "The person cancelled the sign-in."
    }, { mergeWithLastSubmission: false });
    return { redirectTo };
  });

  app.get("/hub/interaction/:uid/resume", async (request, reply) => {
    const signedIn = await current(request);
    if (!signedIn) return reply.redirect(signInPage(request.params.uid), 303);
    try {
      const { redirectTo } = await finishInteraction(request, reply, signedIn.account);
      return reply.redirect(redirectTo, 303);
    } catch (error) {
      if (error instanceof HubError) return reply.redirect(signInPage(request.params.uid), 303);
      throw error;
    }
  });
}

/**
 * Signing in and out, creating an account, confirming its email and recovering its password.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeFastify} app
 * @param {import("./types.js").Hub} hub
 * @param {HubRouteSupport} support
 */
function registerSignInRoutes(app, hub, support) {
  const { accounts, sessions, emailTokens } = hub;
  const { sessionCookie, cookies, writeCookie, current, requireAccount, isOwner, signIn, sendEmail, endEverySession, guardSignInRate, guardEmailRate } = support;

  app.get("/hub/api/session", async (request) => {
    const signedIn = await current(request);
    return {
      account: signedIn ? accountView(signedIn.account) : null,
      isOwner: signedIn ? isOwner(signedIn.account) : false,
      google: Boolean(hub.google)
    };
  });

  app.post("/hub/api/sign-in", async (request, reply) => {
    await guardSignInRate(request);
    const account = await accounts.authenticate(request.body?.email, request.body?.password);
    if (!account) throw hubError(HUB_ERRORS.signInFailed);
    await signIn(request, reply, account, "password");
    return { account: accountView(account), isOwner: isOwner(account) };
  });

  app.post("/hub/api/sign-out", async (request, reply) => {
    await sessions.destroyToken(cookies(request)[sessionCookie]);
    writeCookie(reply, sessionCookie, "", 0);
    return { ok: true };
  });

  app.post("/hub/api/accounts", async (request, reply) => {
    const email = normalizeEmail(request.body?.email);
    await guardEmailRate(request, email);
    const account = await accounts.create({
      email,
      password: String(request.body?.password ?? ""),
      displayName: request.body?.displayName
    });
    await sendEmail(request, account, "confirm", await emailTokens.create(account.id, "confirm"));
    await signIn(request, reply, account, "password");
    return { account: accountView(account), isOwner: isOwner(account) };
  });

  app.post("/hub/api/email/confirm", async (request) => {
    const used = await emailTokens.consume(request.body?.token, "confirm");
    if (!used) throw hubError(HUB_ERRORS.confirmLinkExpired);
    const account = await accounts.markEmailVerified(used.accountId);
    return { account: accountView(account) };
  });

  app.post("/hub/api/email/resend", async (request) => {
    const { account } = await requireAccount(request);
    if (account.emailVerified) return { ok: true };
    await guardEmailRate(request, account.email);
    await sendEmail(request, account, "confirm", await emailTokens.create(account.id, "confirm"));
    return { ok: true };
  });

  app.post("/hub/api/recovery/start", async (request) => {
    const email = normalizeEmail(request.body?.email);
    if (!isEmail(email)) throw hubError(HUB_ERRORS.emailInvalid);
    await guardEmailRate(request, email);
    const account = await accounts.findByEmail(email);
    if (account && !account.disabled) {
      await sendEmail(request, account, "recovery", await emailTokens.create(account.id, "recovery"));
    }
    return { ok: true };
  });

  app.post("/hub/api/recovery/finish", async (request, reply) => {
    const password = String(request.body?.password ?? "");
    const used = await emailTokens.consume(request.body?.token, "recovery");
    if (!used) throw hubError(HUB_ERRORS.recoveryLinkExpired);
    await accounts.setPassword(used.accountId, password);
    const account = await accounts.markEmailVerified(used.accountId);
    await endEverySession(account.id);
    await signIn(request, reply, account, "recovery");
    return { account: accountView(account) };
  });
}

/**
 * Your account: its profile, password, sessions and Google link.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeFastify} app
 * @param {import("./types.js").Hub} hub
 * @param {HubRouteSupport} support
 */
function registerAccountRoutes(app, hub, support) {
  const { accounts, sessions } = hub;
  const { sessionCookie, writeCookie, requireAccount, isOwner, endEverySession, guardSignInRate } = support;

  app.get("/hub/api/account", async (request) => {
    const { account, session } = await requireAccount(request);
    const list = await sessions.listForAccount(account.id);
    return {
      account: accountView(account),
      isOwner: isOwner(account),
      google: Boolean(hub.google),
      sessions: list
        .map((item) => ({ id: item.id, createdAt: item.createdAt, userAgent: item.userAgent, method: item.method, current: item.id === session.id }))
        .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    };
  });

  app.patch("/hub/api/account", async (request) => {
    const { account } = await requireAccount(request);
    return { account: accountView(await accounts.updateProfile(account.id, { displayName: request.body?.displayName })) };
  });

  app.post("/hub/api/account/password", async (request) => {
    const { account } = await requireAccount(request);
    if (account.hasPassword) {
      await guardSignInRate(request);
      if (!(await accounts.checkPassword(account.id, request.body?.currentPassword))) {
        throw hubError(HUB_ERRORS.currentPasswordWrong);
      }
    }
    return { account: accountView(await accounts.setPassword(account.id, String(request.body?.newPassword ?? ""))) };
  });

  app.delete("/hub/api/account/sessions/:id", async (request) => {
    const { account } = await requireAccount(request);
    const owned = (await sessions.listForAccount(account.id)).some((item) => item.id === request.params.id);
    if (owned) await sessions.destroy(request.params.id);
    return { ok: true };
  });

  app.post("/hub/api/account/sign-out-everywhere", async (request, reply) => {
    const { account } = await requireAccount(request);
    await endEverySession(account.id);
    writeCookie(reply, sessionCookie, "", 0);
    return { ok: true };
  });

  app.post("/hub/api/account/google/unlink", async (request) => {
    const { account } = await requireAccount(request);
    return { account: accountView(await accounts.unlinkGoogle(account.id)) };
  });
}

/**
 * Continue with Google: signing in, linking, and connecting Google to an existing account.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeFastify} app
 * @param {import("./types.js").Hub} hub
 * @param {HubRouteSupport} support
 */
function registerGoogleRoutes(app, hub, support) {
  const { accounts, emailTokens } = hub;
  const { cookies, writeCookie, current, requireAccount, signIn, sendEmail, endEverySession, guardSignInRate, guardEmailRate } = support;
  const googleLinks = new hub.Adapter(GOOGLE_LINK_KIND);

  function requireGoogle() {
    if (!hub.google) throw hubError(HUB_ERRORS.googleDisabled);
  }

  function googleDone(uid) {
    return uid ? `/hub/interaction/${encodeURIComponent(uid)}/resume` : "/account";
  }

  app.get("/hub/google/start", async (request, reply) => {
    requireGoogle();
    const intent = request.query.intent === "link" ? "link" : "sign-in";
    const signedIn = intent === "link" ? await requireAccount(request) : null;
    // Linking needs a confirmed email: otherwise someone could create an
    // account with another person's email and keep a Google way in after
    // that person recovers it.
    if (signedIn && !signedIn.account.emailVerified) return reply.redirect("/account?google=unverified", 303);
    const { url, state } = await hub.google.start({
      intent,
      uid: typeof request.query.interaction === "string" ? request.query.interaction : null,
      accountId: signedIn?.account.id ?? null
    });
    writeCookie(reply, GOOGLE_STATE_COOKIE, state, 600);
    return reply.redirect(url, 303);
  });

  app.get("/hub/google/callback", async (request, reply) => {
    requireGoogle();
    writeCookie(reply, GOOGLE_STATE_COOKIE, "", 0);
    let outcome = null;
    try {
      outcome = await hub.google.finish({
        code: request.query.code,
        state: request.query.state,
        browserState: cookies(request)[GOOGLE_STATE_COOKIE]
      });
    } catch (error) {
      hub.logger.warn({ err: error }, "Google sign-in could not be verified.");
    }
    if (!outcome) return reply.redirect("/auth/sign-in?google=failed", 303);
    const { identity, uid } = outcome;

    if (outcome.intent === "link") {
      const signedIn = await current(request);
      const owner = await accounts.findByGoogleSub(identity.sub);
      if (!signedIn || signedIn.account.id !== outcome.accountId || (owner && owner.id !== signedIn.account.id)) {
        return reply.redirect("/account?google=taken", 303);
      }
      if (!signedIn.account.emailVerified) return reply.redirect("/account?google=unverified", 303);
      await accounts.linkGoogle(signedIn.account.id, identity.sub);
      return reply.redirect("/account?google=linked", 303);
    }

    const linked = await accounts.findByGoogleSub(identity.sub);
    if (linked) {
      if (linked.disabled) return reply.redirect("/auth/sign-in?google=failed", 303);
      await signIn(request, reply, linked, "google");
      return reply.redirect(googleDone(uid), 303);
    }
    const sameEmail = identity.email ? await accounts.findByEmail(identity.email) : null;
    if (sameEmail) {
      if (sameEmail.disabled) return reply.redirect("/auth/sign-in?google=failed", 303);
      if (sameEmail.emailVerified && identity.emailVerified) {
        const account = await accounts.linkGoogle(sameEmail.id, identity.sub);
        await signIn(request, reply, account, "google");
        return reply.redirect(googleDone(uid), 303);
      }
      const linkId = randomToken(24);
      await googleLinks.upsert(linkId, { accountId: sameEmail.id, googleSub: identity.sub, uid }, GOOGLE_LINK_TTL_SECONDS);
      writeCookie(reply, GOOGLE_LINK_COOKIE, linkId, GOOGLE_LINK_TTL_SECONDS);
      return reply.redirect("/auth/connect-google", 303);
    }
    if (!identity.email || !identity.emailVerified) return reply.redirect("/auth/sign-in?google=unverified", 303);
    const account = await accounts.create({
      email: identity.email,
      displayName: identity.name,
      emailVerified: true,
      googleSub: identity.sub
    });
    await signIn(request, reply, account, "google");
    return reply.redirect(googleDone(uid), 303);
  });

  async function pendingGoogleLink(request) {
    const id = cookies(request)[GOOGLE_LINK_COOKIE];
    const link = id ? await googleLinks.find(id) : null;
    if (!link) throw hubError(HUB_ERRORS.googleConnectionExpired);
    return { id, link, account: await accounts.findById(link.accountId) };
  }

  app.get("/hub/api/google/link", async (request) => {
    const { account } = await pendingGoogleLink(request);
    return { email: account.email, hasPassword: account.hasPassword };
  });

  app.post("/hub/api/google/link/password", async (request, reply) => {
    const { id, link, account } = await pendingGoogleLink(request);
    await guardSignInRate(request);
    const verified = await accounts.authenticate(account.email, request.body?.password);
    if (!verified) throw hubError(HUB_ERRORS.signInFailed);
    await accounts.linkGoogle(account.id, link.googleSub);
    // Google confirmed this same address, so it counts as confirmed here.
    await accounts.markEmailVerified(account.id);
    await googleLinks.destroy(id);
    writeCookie(reply, GOOGLE_LINK_COOKIE, "", 0);
    await signIn(request, reply, verified, "google");
    return { redirectTo: googleDone(link.uid) };
  });

  app.post("/hub/api/google/link/email", async (request) => {
    const { link, account } = await pendingGoogleLink(request);
    await guardEmailRate(request, account.email);
    await sendEmail(request, account, "google-link", await emailTokens.create(account.id, "google-link", { googleSub: link.googleSub }));
    return { ok: true };
  });

  app.post("/hub/api/google/link/finish", async (request, reply) => {
    const used = await emailTokens.consume(request.body?.token, "google-link");
    if (!used) throw hubError(HUB_ERRORS.googleLinkExpired);
    if (await accounts.findByGoogleSub(used.payload.googleSub)) {
      throw hubError(HUB_ERRORS.googleTaken);
    }
    await accounts.clearPassword(used.accountId);
    await accounts.setPassword(used.accountId, String(request.body?.password ?? ""));
    await accounts.linkGoogle(used.accountId, used.payload.googleSub);
    const account = await accounts.markEmailVerified(used.accountId);
    await endEverySession(account.id);
    await signIn(request, reply, account, "google");
    return { account: accountView(account) };
  });
}

/**
 * Admin: the hub's apps, people and setup, for its owner.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeFastify} app
 * @param {import("./types.js").Hub} hub
 * @param {HubRouteSupport} support
 */
function registerAdminRoutes(app, hub, support) {
  const { config, accounts, clients, settings, mailer, texts } = hub;
  const { hubHost, isOwner, requireOwner, endEverySession } = support;

  app.get("/hub/api/admin/apps", async (request) => {
    await requireOwner(request);
    const rows = (await clients.list()).map(appView);
    return {
      waiting: rows.filter((row) => row.status === "pending"),
      approved: rows.filter((row) => row.status === "active"),
      development: rows.filter((row) => row.status === "active-dev"),
      blocked: rows.filter((row) => row.status === "blocked"),
      keys: await hub.keys.summary()
    };
  });

  app.post("/hub/api/admin/apps/:clientId/:action", async (request) => {
    const { account } = await requireOwner(request);
    const { clientId, action } = request.params;
    const done = {
      approve: () => clients.approve(clientId, account.id),
      block: () => clients.blockOrigin(clientId),
      remove: () => clients.remove(clientId)
    }[action];
    if (!done) throw hubError(HUB_ERRORS.unknownAction);
    if (!(await done())) throw hubError(HUB_ERRORS.appNotFound);
    return { ok: true };
  });

  app.post("/hub/api/admin/keys/rotate", async (request) => {
    await requireOwner(request);
    return { kid: await hub.rotateSigningKey(), keys: await hub.keys.summary() };
  });

  app.get("/hub/api/admin/people", async (request) => {
    await requireOwner(request);
    return {
      people: (await accounts.list()).map((account) => ({
        ...accountView(account),
        disabled: account.disabled,
        locked: account.locked,
        isOwner: isOwner(account),
        createdAt: account.createdAt
      }))
    };
  });

  app.post("/hub/api/admin/people/:id/:action", async (request) => {
    const { account: owner } = await requireOwner(request);
    const { id, action } = request.params;
    if (!["disable", "enable"].includes(action)) throw hubError(HUB_ERRORS.unknownAction);
    if (id === owner.id) throw hubError(HUB_ERRORS.ownerSelf);
    const target = await accounts.findById(id);
    if (!target) throw hubError(HUB_ERRORS.personNotFound);
    await accounts.setDisabled(id, action === "disable");
    if (action === "disable") await endEverySession(id);
    return { ok: true };
  });

  app.get("/hub/api/admin/setup", async (request) => {
    await requireOwner(request);
    const [domain, emailTest, keyList, owner] = await Promise.all([
      settings.get("domain-confirmed"),
      settings.get("email-test"),
      hub.keys.summary(),
      accounts.findByEmail(config.ownerEmail)
    ]);
    const activeKey = keyList.find((key) => key.state === "active");
    return {
      issuer: config.issuer,
      googleRedirectUri: `${config.issuer}/hub/google/callback`,
      ownerEmail: config.ownerEmail,
      devOriginPatterns: config.devOriginPatterns,
      items: [
        { id: "https", state: config.secure ? "ok" : "warning" },
        { id: "domain", state: domain?.confirmed ? "ok" : "todo" },
        { id: "secret", state: config.secretFromEnv ? "ok" : "warning" },
        { id: "registration-token", state: "ok" },
        { id: "owner", state: owner?.emailVerified ? "ok" : "warning" },
        { id: "email", state: !mailer.configured ? "warning" : emailTest?.ok ? "ok" : "todo", lastTestAt: emailTest?.at ?? null },
        { id: "google", state: hub.google ? "ok" : "todo" },
        { id: "signing-key", state: activeKey ? "ok" : "warning", activeSince: activeKey?.createdAt ?? null },
        { id: "development", state: "ok" }
      ]
    };
  });

  app.post("/hub/api/admin/setup/test-email", async (request) => {
    const { account } = await requireOwner(request);
    const locale = requestLocale(texts, request);
    try {
      await mailer.send({
        to: account.email,
        subject: texts.t(locale, "jskit.accounts.mail.test.subject"),
        ...composeMessage({
          heading: texts.t(locale, "jskit.accounts.mail.test.heading"),
          body: texts.t(locale, "jskit.accounts.mail.test.body"),
          actionLabel: texts.t(locale, "jskit.accounts.mail.test.action"),
          actionUrl: `${config.issuer}/admin/setup`,
          footer: texts.t(locale, "jskit.accounts.mail.test.footer", { host: hubHost })
        })
      });
    } catch (error) {
      await settings.set("email-test", { ok: false, at: hub.now().toISOString() });
      throw hubError(HUB_ERRORS.testEmailFailed, { reason: error.message });
    }
    await settings.set("email-test", { ok: true, at: hub.now().toISOString() });
    return { ok: true };
  });

  app.post("/hub/api/admin/setup/domain", async (request) => {
    await requireOwner(request);
    const confirmed = request.body?.confirmed === true;
    await settings.set("domain-confirmed", { confirmed });
    return { confirmed };
  });
}

/**
 * Development: an editor's preview signs in as an existing account.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeFastify} app
 * @param {import("./types.js").Hub} hub
 * @param {HubRouteSupport} support
 */
function registerDevelopmentRoutes(app, hub, support) {
  const { config, accounts } = hub;
  const { signIn } = support;

  app.post("/hub/api/dev/login-as", async (request, reply) => {
    const { enabled, secret } = hub.devAuth;
    if (config.isProduction || !enabled || !secret || !isLoopbackRequest(request)) {
      throw new HubError(404, "not_found", "Not found.");
    }
    if (!constantEquals(request.headers[DEV_AUTH_SECRET_HEADER], secret)) {
      throw new HubError(403, "dev_auth_refused", "This preview sign-in is not authorised.");
    }
    const account = request.body?.userId
      ? await accounts.findById(request.body.userId)
      : await accounts.findByEmail(request.body?.email);
    if (!account || account.disabled) {
      throw new HubError(404, "account_not_found", "No hub account matches. Create the account first.");
    }
    await signIn(request, reply, account, "preview");
    return { ok: true, userId: account.id, email: account.email, displayName: account.displayName };
  });
}

/**
 * The hub's own JSON API (sign-in, account, admin) and the browser hops of
 * an app's sign-in (interaction and Google). Every state-changing call needs
 * the `x-hub-request` header, which a cross-site form cannot send.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeFastify} app
 * @param {import("./types.js").Hub} hub
 */
function registerHubRoutes(app, hub) {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HubError || error instanceof AccountError) {
      return reply.code(error.status).send(errorBody(error));
    }
    hub.logger.error({ err: error }, "Accounts hub request failed.");
    return reply.code(HUB_ERRORS.failed.status).send(errorBody(hubError(HUB_ERRORS.failed)));
  });

  app.addHook("onRequest", async (request) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    if (request.headers["x-hub-request"] !== "1") {
      throw hubError(HUB_ERRORS.hubRequestRequired);
    }
  });

  const support = createHubRouteSupport(hub);
  registerInteractionRoutes(app, hub, support);
  registerSignInRoutes(app, hub, support);
  registerAccountRoutes(app, hub, support);
  registerGoogleRoutes(app, hub, support);
  registerAdminRoutes(app, hub, support);
  registerDevelopmentRoutes(app, hub, support);
}

export { registerHubRoutes };
