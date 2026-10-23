import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { REGISTRATION_TOKEN } from "./hub.js";

/** A cookie-keeping fetch that never follows redirects by itself. */
function createBrowser() {
  const jar = new Map();
  function store(url, response) {
    const host = new URL(url).host;
    for (const cookie of response.headers.getSetCookie()) {
      const [pair, ...attributes] = cookie.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const pathAttribute = attributes.map((part) => part.trim()).find((part) => /^path=/iu.test(part));
      const cookiePath = pathAttribute ? pathAttribute.slice(5) : "/";
      const maxAge = attributes.map((part) => part.trim()).find((part) => /^max-age=/iu.test(part));
      const key = `${host}|${cookiePath}|${name}`;
      if (!value || (maxAge && Number(maxAge.slice(8)) <= 0) || /expires=thu, 01 jan 1970/iu.test(cookie)) jar.delete(key);
      else jar.set(key, { host, path: cookiePath, name, value });
    }
  }
  function cookieHeader(url) {
    const { host, pathname } = new URL(url);
    return [...jar.values()]
      .filter((cookie) => cookie.host === host && pathname.startsWith(cookie.path))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
  }
  async function request(url, { method = "GET", headers = {}, body } = {}) {
    const response = await fetch(url, {
      method,
      redirect: "manual",
      headers: { cookie: cookieHeader(url), ...headers },
      body
    });
    store(url, response);
    return response;
  }
  return {
    request,
    api(url, { method = "POST", body, headers = {} } = {}) {
      return request(url, {
        method,
        headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), "x-hub-request": "1", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    },
    /** Follows redirects until a URL matches `stop` (or a non-redirect response). */
    async follow(url, stop = () => false) {
      let current = url;
      for (let hops = 0; hops < 10; hops += 1) {
        if (stop(current)) return { url: current, response: null };
        const response = await request(current);
        const location = response.headers.get("location");
        if (!location || response.status < 300 || response.status >= 400) return { url: current, response };
        current = new URL(location, current).toString();
      }
      throw new Error("Too many redirects.");
    }
  };
}

async function registerApp(hubUrl, { origin = "http://localhost:4100", name = "Shop", token = REGISTRATION_TOKEN, extra = {} } = {}) {
  const response = await fetch(`${hubUrl}/oidc/reg`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [`${origin}/auth/callback`],
      post_logout_redirect_uris: [`${origin}/`],
      backchannel_logout_uri: `${origin}/api/auth/oidc/backchannel-logout`,
      token_endpoint_auth_method: "client_secret_basic",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      ...extra
    })
  });
  return { response, body: await response.json().catch(() => null) };
}

function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function authorizationUrl(hubUrl, client, { pkce = pkcePair(), state = "state-1", nonce = "nonce-1", redirectUri, omitPkce = false } = {}) {
  const url = new URL(`${hubUrl}/oidc/auth`);
  url.search = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri || client.redirect_uris[0],
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    ...(omitPkce ? {} : { code_challenge: pkce.challenge, code_challenge_method: "S256" })
  }).toString();
  return { url: url.toString(), pkce };
}

function interactionUid(url) {
  return new URL(url).searchParams.get("interaction") || /\/hub\/interaction\/([^/?]+)/u.exec(url)?.[1] || "";
}

/** Runs an app sign-in through the hub with email and password and returns the callback URL. */
async function signInThroughHub(browser, hubUrl, client, { email, password, pkce } = {}) {
  const { url, pkce: usedPkce } = authorizationUrl(hubUrl, client, { pkce });
  const isCallback = (current) => current.startsWith(client.redirect_uris[0].split("?")[0]) && current.includes("code=");
  const atSignIn = await browser.follow(url, (current) => current.includes("/auth/sign-in?interaction=") || isCallback(current));
  if (isCallback(atSignIn.url)) return { callbackUrl: atSignIn.url, pkce: usedPkce };
  const uid = interactionUid(atSignIn.url);
  await browser.api(`${hubUrl}/hub/api/sign-in`, { body: { email, password } });
  const resumed = await browser.api(`${hubUrl}/hub/interaction/${uid}/continue`, { body: {} });
  const { redirectTo, error, message } = await resumed.json();
  if (!redirectTo) return { error, message, uid, pkce: usedPkce };
  const final = await browser.follow(redirectTo, isCallback);
  return { callbackUrl: final.url, pkce: usedPkce, uid };
}

async function redeemCode(hubUrl, client, callbackUrl, pkce) {
  const code = new URL(callbackUrl).searchParams.get("code");
  const response = await fetch(`${hubUrl}/oidc/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${encodeURIComponent(client.client_id)}:${encodeURIComponent(client.client_secret)}`).toString("base64")}`
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: client.redirect_uris[0],
      code_verifier: pkce.verifier
    })
  });
  return { response, body: await response.json() };
}

async function verifyIdToken(hubUrl, client, idToken) {
  const jwks = createRemoteJWKSet(new URL(`${hubUrl}/oidc/jwks`));
  return jwtVerify(idToken, jwks, { issuer: hubUrl, audience: client.client_id });
}

async function createAccount(browser, hubUrl, { email, password = "correct horse battery staple", displayName = "" }) {
  const response = await browser.api(`${hubUrl}/hub/api/accounts`, { body: { email, password, displayName } });
  return { response, body: await response.json() };
}

export {
  authorizationUrl,
  createAccount,
  createBrowser,
  interactionUid,
  pkcePair,
  redeemCode,
  registerApp,
  signInThroughHub,
  verifyIdToken
};
