import Fastify from "fastify";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

/** A stand-in for Google's OAuth endpoints. `nextIdentity` is who "signs in" next. */
async function startMockGoogle() {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "mock", alg: "ES256", use: "sig" };
  const codes = new Map();
  const app = Fastify({ logger: false, forceCloseConnections: true });
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body)));
  });
  const mock = { nextIdentity: null, url: "" };
  app.get("/auth", async (request, reply) => {
    const code = `code-${codes.size + 1}`;
    codes.set(code, { identity: mock.nextIdentity, nonce: request.query.nonce, clientId: request.query.client_id });
    const target = new URL(request.query.redirect_uri);
    target.searchParams.set("code", code);
    target.searchParams.set("state", request.query.state);
    return reply.redirect(target.toString(), 303);
  });
  app.post("/token", async (request) => {
    const grant = codes.get(request.body.code);
    codes.delete(request.body.code);
    const idToken = await new SignJWT({
      email: grant.identity.email,
      email_verified: grant.identity.emailVerified,
      name: grant.identity.name || "",
      nonce: grant.nonce
    })
      .setProtectedHeader({ alg: "ES256", kid: "mock" })
      .setIssuer(mock.url)
      .setAudience(grant.clientId)
      .setSubject(grant.identity.sub)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    return { access_token: "mock", token_type: "Bearer", id_token: idToken };
  });
  app.get("/jwks", async () => ({ keys: [jwk] }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  mock.url = `http://127.0.0.1:${app.server.address().port}`;
  mock.endpoints = {
    issuer: mock.url,
    authorization: `${mock.url}/auth`,
    token: `${mock.url}/token`,
    jwks: `${mock.url}/jwks`
  };
  mock.stop = () => app.close();
  return mock;
}

export { startMockGoogle };
