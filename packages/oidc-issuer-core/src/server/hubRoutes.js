import { AccountError, isEmail, normalizeEmail } from "./accounts.js";
import { constantEquals, randomToken } from "./crypto.js";
import { HubError, appendCookie, clientIp, parseCookies, serializeCookie } from "./http.js";
import { hubSessionCookieName } from "./hubSessions.js";
import { composeMessage } from "./mailer.js";
import { ACTIVE_STATUSES, HUB_SCOPES } from "./oidcProvider.js";

const GOOGLE_STATE_COOKIE = "hub_google_state";
const GOOGLE_LINK_COOKIE = "hub_google_link";
const GOOGLE_LINK_KIND = "GoogleLink";
const GOOGLE_LINK_TTL_SECONDS = 600;
const DEV_AUTH_SECRET_HEADER = "x-jskit-dev-auth-secret";
const PENDING_SENTENCE = "This app is waiting for approval by the hub's owner.";
const UNCONFIRMED_SENTENCE = "Confirm your email to continue: open the link we sent you, then press Continue.";
const NO_MATCH_SENTENCE = "That email and password don't match.";
const TOO_MANY_SENTENCE = "Too many attempts. Wait a little and try again.";

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

/**
 * The hub's own JSON API (sign-in, account, admin) and the browser hops of
 * an app's sign-in (interaction and Google). Every state-changing call needs
 * the `x-hub-request` header, which a cross-site form cannot send.
 */
function registerHubRoutes(app, hub) {
  const { config, accounts, clients, sessions, settings, emailTokens, rateLimiter, mailer } = hub;
  const sessionCookie = hubSessionCookieName(config);
  const googleLinks = new hub.Adapter(GOOGLE_LINK_KIND);
  const hubHost = new URL(config.issuer).host;

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HubError || error instanceof AccountError) {
      return reply.code(error.status).send({ error: error.code, message: error.message });
    }
    hub.logger.error?.({ err: error }, "Accounts hub request failed.");
    return reply.code(500).send({ error: "hub_failed", message: "Something went wrong. Try again in a moment." });
  });

  app.addHook("onRequest", async (request) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    if (request.headers["x-hub-request"] !== "1") {
      throw new HubError(403, "hub_request_required", "This request must come from the hub's own pages.");
    }
  });

  function cookies(request) {
    return parseCookies(request.headers.cookie);
  }

  function setCookie(reply, name, value, maxAge) {
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
    if (!signedIn) throw new HubError(401, "sign_in_required", "Sign in to continue.");
    return signedIn;
  }

  function isOwner(account) {
    return account.emailVerified && account.email === config.ownerEmail;
  }

  async function requireOwner(request) {
    const signedIn = await requireAccount(request);
    if (!isOwner(signedIn.account)) {
      throw new HubError(403, "owner_required", "Only the hub's owner can open this page.");
    }
    return signedIn;
  }

  async function signIn(request, reply, account, method) {
    await sessions.destroyToken(cookies(request)[sessionCookie]);
    const token = await sessions.create(account.id, { userAgent: request.headers["user-agent"], method });
    setCookie(reply, sessionCookie, token, sessions.ttlSeconds);
  }

  async function sendEmail(account, purpose, token) {
    const link = (path) => `${config.issuer}${path}?token=${encodeURIComponent(token)}`;
    const messages = {
      confirm: {
        subject: "Confirm your email",
        heading: "Confirm your email",
        body: `Confirm ${account.email} so your apps know it is really yours.`,
        actionLabel: "Confirm email",
        actionUrl: link("/auth/confirm-email")
      },
      recovery: {
        subject: "Reset your password",
        heading: "Reset your password",
        body: "Someone asked to reset the password of your account. The link works once, for one hour.",
        actionLabel: "Choose a new password",
        actionUrl: link("/auth/reset-password")
      },
      "google-link": {
        subject: "Connect Google to your account",
        heading: "Connect Google to your account",
        body: "Open the link to connect your Google sign-in and choose a new password. The link works once, for one hour.",
        actionLabel: "Connect Google",
        actionUrl: link("/auth/connect-google")
      }
    };
    const { subject, ...content } = messages[purpose];
    await mailer.send({
      to: account.email,
      subject,
      ...composeMessage({ ...content, footer: `Sent by your accounts hub at ${hubHost}. If you did not ask for this, ignore this email.` })
    });
  }

  /** Ends the account's hub and app sessions everywhere, including apps' own sessions through back-channel logout. */
  async function endEverySession(accountId) {
    await sessions.destroyAllForAccount(accountId);
    await hub.backchannelLogout(accountId);
  }

  async function guardSignInRate(request) {
    if (!(await rateLimiter.signIn(clientIp(request)))) throw new HubError(429, "rate_limited", TOO_MANY_SENTENCE);
  }

  async function guardEmailRate(request, email) {
    if (!(await rateLimiter.email(email, clientIp(request)))) throw new HubError(429, "rate_limited", TOO_MANY_SENTENCE);
  }

  /* ---------------- Interactions: an app's sign-in passing through the hub ---------------- */

  async function loadInteraction(request, reply) {
    let details;
    try {
      details = await hub.provider.interactionDetails(request.raw, reply.raw);
    } catch {
      details = null;
    }
    if (!details || details.uid !== request.params.uid) {
      throw new HubError(404, "interaction_expired", "This sign-in has expired. Go back to the app and try again.");
    }
    const appRow = await clients.get(details.params.client_id);
    return { details, appRow };
  }

  async function finishInteraction(request, reply, account) {
    const { details, appRow } = await loadInteraction(request, reply);
    if (!appRow || !ACTIVE_STATUSES.has(appRow.status)) throw new HubError(409, "app_pending", PENDING_SENTENCE);
    // Apps trust the email they receive (invitations, for example), so an
    // address nobody has confirmed never reaches them.
    if (!account.emailVerified) throw new HubError(409, "email_unconfirmed", UNCONFIRMED_SENTENCE);
    let result = { login: { accountId: account.id } };
    if (details.prompt.name === "consent" && details.session?.accountId === account.id) {
      const grant = new hub.provider.Grant({ accountId: account.id, clientId: appRow.client_id });
      grant.addOIDCScope(HUB_SCOPES);
      result = { consent: { grantId: await grant.save() } };
    }
    const redirectTo = await hub.provider.interactionResult(request.raw, reply.raw, result);
    return { redirectTo };
  }

  function signInPage(uid) {
    return `/auth/sign-in?interaction=${encodeURIComponent(uid)}`;
  }

  app.get("/hub/interaction/:uid", async (request, reply) => {
    return reply.redirect(signInPage(request.params.uid), 303);
  });

  app.get("/hub/interaction/:uid/details", async (request, reply) => {
    const { appRow } = await loadInteraction(request, reply);
    const signedIn = await current(request);
    return {
      app: appRow ? { name: appRow.client_name, origin: appRow.origin, status: appRow.status } : null,
      account: signedIn ? accountView(signedIn.account) : null,
      google: Boolean(hub.google)
    };
  });

  app.post("/hub/interaction/:uid/continue", async (request, reply) => {
    const { account } = await requireAccount(request);
    return finishInteraction(request, reply, account);
  });

  app.post("/hub/interaction/:uid/cancel", async (request, reply) => {
    await loadInteraction(request, reply);
    const redirectTo = await hub.provider.interactionResult(request.raw, reply.raw, {
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

  /* ---------------- Sign-in, accounts, email ---------------- */

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
    if (!account) throw new HubError(401, "sign_in_failed", NO_MATCH_SENTENCE);
    await signIn(request, reply, account, "password");
    return { account: accountView(account), isOwner: isOwner(account) };
  });

  app.post("/hub/api/sign-out", async (request, reply) => {
    await sessions.destroyToken(cookies(request)[sessionCookie]);
    setCookie(reply, sessionCookie, "", 0);
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
    await sendEmail(account, "confirm", await emailTokens.create(account.id, "confirm"));
    await signIn(request, reply, account, "password");
    return { account: accountView(account), isOwner: isOwner(account) };
  });

  app.post("/hub/api/email/confirm", async (request) => {
    const used = await emailTokens.consume(request.body?.token, "confirm");
    if (!used) throw new HubError(410, "link_expired", "This link has expired or was already used. Send a new one from your account.");
    const account = await accounts.markEmailVerified(used.accountId);
    return { account: accountView(account) };
  });

  app.post("/hub/api/email/resend", async (request) => {
    const { account } = await requireAccount(request);
    if (account.emailVerified) return { ok: true };
    await guardEmailRate(request, account.email);
    await sendEmail(account, "confirm", await emailTokens.create(account.id, "confirm"));
    return { ok: true };
  });

  app.post("/hub/api/recovery/start", async (request) => {
    const email = normalizeEmail(request.body?.email);
    if (!isEmail(email)) throw new HubError(400, "email_invalid", "Enter a valid email address.");
    await guardEmailRate(request, email);
    const account = await accounts.findByEmail(email);
    if (account && !account.disabled) {
      await sendEmail(account, "recovery", await emailTokens.create(account.id, "recovery"));
    }
    return { ok: true };
  });

  app.post("/hub/api/recovery/finish", async (request, reply) => {
    const password = String(request.body?.password ?? "");
    const used = await emailTokens.consume(request.body?.token, "recovery");
    if (!used) throw new HubError(410, "link_expired", "This link has expired or was already used. Ask for a new one.");
    await accounts.setPassword(used.accountId, password);
    const account = await accounts.markEmailVerified(used.accountId);
    await endEverySession(account.id);
    await signIn(request, reply, account, "recovery");
    return { account: accountView(account) };
  });

  /* ---------------- Your account ---------------- */

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
        throw new HubError(400, "current_password_wrong", "Your current password is not right.");
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
    setCookie(reply, sessionCookie, "", 0);
    return { ok: true };
  });

  app.post("/hub/api/account/google/unlink", async (request) => {
    const { account } = await requireAccount(request);
    return { account: accountView(await accounts.unlinkGoogle(account.id)) };
  });

  /* ---------------- Google ---------------- */

  function requireGoogle() {
    if (!hub.google) throw new HubError(404, "google_disabled", "Continue with Google is not set up on this hub.");
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
    setCookie(reply, GOOGLE_STATE_COOKIE, state, 600);
    return reply.redirect(url, 303);
  });

  app.get("/hub/google/callback", async (request, reply) => {
    requireGoogle();
    setCookie(reply, GOOGLE_STATE_COOKIE, "", 0);
    let outcome = null;
    try {
      outcome = await hub.google.finish({
        code: request.query.code,
        state: request.query.state,
        browserState: cookies(request)[GOOGLE_STATE_COOKIE]
      });
    } catch (error) {
      hub.logger.warn?.({ err: error }, "Google sign-in could not be verified.");
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
      setCookie(reply, GOOGLE_LINK_COOKIE, linkId, GOOGLE_LINK_TTL_SECONDS);
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
    if (!link) throw new HubError(410, "link_expired", "This Google connection has expired. Continue with Google again.");
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
    if (!verified) throw new HubError(401, "sign_in_failed", NO_MATCH_SENTENCE);
    await accounts.linkGoogle(account.id, link.googleSub);
    // Google confirmed this same address, so it counts as confirmed here.
    await accounts.markEmailVerified(account.id);
    await googleLinks.destroy(id);
    setCookie(reply, GOOGLE_LINK_COOKIE, "", 0);
    await signIn(request, reply, verified, "google");
    return { redirectTo: googleDone(link.uid) };
  });

  app.post("/hub/api/google/link/email", async (request) => {
    const { link, account } = await pendingGoogleLink(request);
    await guardEmailRate(request, account.email);
    await sendEmail(account, "google-link", await emailTokens.create(account.id, "google-link", { googleSub: link.googleSub }));
    return { ok: true };
  });

  app.post("/hub/api/google/link/finish", async (request, reply) => {
    const used = await emailTokens.consume(request.body?.token, "google-link");
    if (!used) throw new HubError(410, "link_expired", "This link has expired or was already used. Continue with Google again.");
    if (await accounts.findByGoogleSub(used.payload.googleSub)) {
      throw new HubError(409, "google_taken", "This Google account is already connected to another account.");
    }
    await accounts.clearPassword(used.accountId);
    await accounts.setPassword(used.accountId, String(request.body?.password ?? ""));
    await accounts.linkGoogle(used.accountId, used.payload.googleSub);
    const account = await accounts.markEmailVerified(used.accountId);
    await endEverySession(account.id);
    await signIn(request, reply, account, "google");
    return { account: accountView(account) };
  });

  /* ---------------- Admin: Apps, People, Setup ---------------- */

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
    if (!done) throw new HubError(404, "unknown_action", "That action does not exist.");
    if (!(await done())) throw new HubError(404, "app_not_found", "This app is no longer registered. Refresh the page.");
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
    if (!["disable", "enable"].includes(action)) throw new HubError(404, "unknown_action", "That action does not exist.");
    if (id === owner.id) throw new HubError(400, "owner_self", "You cannot turn off your own account.");
    const target = await accounts.findById(id);
    if (!target) throw new HubError(404, "person_not_found", "This person no longer has an account. Refresh the page.");
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
    try {
      await mailer.send({
        to: account.email,
        subject: "Your accounts hub can send email",
        ...composeMessage({
          heading: "Email works",
          body: "Your hub sent this message with your own sender, so confirmation and recovery emails will arrive.",
          actionLabel: "Open your hub",
          actionUrl: `${config.issuer}/admin/setup`,
          footer: `Sent by your accounts hub at ${hubHost}.`
        })
      });
    } catch (error) {
      await settings.set("email-test", { ok: false, at: hub.now().toISOString() });
      throw new HubError(502, "email_failed", `The test email was not sent: ${error.message}`);
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

  /* ---------------- Development: an editor's preview signs in as an existing account ---------------- */

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

export { registerHubRoutes };
