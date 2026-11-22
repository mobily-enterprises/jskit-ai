import { randomBytes } from "node:crypto";
import http from "node:http";
import Stripe from "stripe";

// A stand-in for the part of Stripe's API that top-ups use, for the real Stripe SDK to talk to through the adapter's
// apiBaseUrl: the account and balance the adapter verifies, and Checkout sessions created (once per idempotency key)
// and read back. The test moves a session on (pay, clearing, expire) as Stripe would, and signs webhook events with
// the endpoint's secret as Stripe does. It records each request, so a test sees what reached "Stripe". Nothing here
// leaves the machine.

/** Stripe's form encoding read back into objects: `line_items[0][price_data][currency]=usd`. */
function formParams(text) {
  const result = {};
  for (const [name, value] of new URLSearchParams(text)) {
    const keys = name.replace(/\]/gu, "").split("[");
    let at = result;
    keys.forEach((key, index) => {
      if (index === keys.length - 1) at[key] = value;
      else at = at[key] ??= /^\d+$/u.test(keys[index + 1]) ? [] : {};
    });
  }
  return result;
}

/**
 * @param {{ accountId?: string, secretKey?: string, webhookSecret?: string, retrieveDelayMs?: number }} [options]
 *   `retrieveDelayMs` holds each session read that long, to widen a race.
 */
export async function startFakeStripe({ accountId = "acct_stand_in", secretKey = "sk_test_stand_in", webhookSecret = "whsec_stand_in", retrieveDelayMs = 0 } = {}) {
  const sessions = new Map();
  const byKey = new Map();
  const requests = [];
  const signer = new Stripe(secretKey);
  let count = 0;
  let url = "";

  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const address = new URL(request.url, "http://stand-in");
    requests.push({ method: request.method, path: address.pathname, authorization: request.headers.authorization, idempotencyKey: request.headers["idempotency-key"] ?? null });
    const json = (status, value) => {
      response.writeHead(status, { "content-type": "application/json", "request-id": `req_${++count}` });
      response.end(JSON.stringify(value));
    };
    const refused = (status, message) => json(status, { error: { type: "invalid_request_error", message } });
    if (request.headers.authorization !== `Bearer ${secretKey}`) return refused(401, "Invalid API Key provided.");
    if (request.method === "GET" && address.pathname === "/v1/account") {
      return json(200, { id: accountId, object: "account", charges_enabled: true, payouts_enabled: true });
    }
    if (request.method === "GET" && address.pathname === "/v1/balance") return json(200, { object: "balance", livemode: false, available: [], pending: [] });
    if (request.method === "POST" && address.pathname === "/v1/checkout/sessions") {
      const key = request.headers["idempotency-key"];
      if (key && byKey.has(key)) return json(200, sessions.get(byKey.get(key)));
      const params = formParams(body);
      const item = params.line_items?.[0];
      const id = `cs_test_${randomBytes(8).toString("hex")}`;
      const session = {
        ...params,
        id,
        object: "checkout.session",
        livemode: false,
        url: `${url}/pay/${id}`,
        status: "open",
        payment_status: "unpaid",
        payment_intent: null,
        currency: item?.price_data?.currency,
        amount_total: Number(item?.price_data?.unit_amount) * Number(item?.quantity || 1)
      };
      sessions.set(id, session);
      if (key) byKey.set(key, id);
      return json(200, session);
    }
    const read = /^\/v1\/checkout\/sessions\/(cs_test_\w+)$/u.exec(address.pathname);
    if (request.method === "GET" && read) {
      if (retrieveDelayMs) await new Promise((resolve) => setTimeout(resolve, retrieveDelayMs));
      const session = sessions.get(read[1]);
      return session ? json(200, session) : refused(404, "No such checkout.session");
    }
    return refused(404, "Unrecognized request URL");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;

  const change = (id, values) => Object.assign(sessions.get(id), values);
  return {
    url,
    accountId,
    secretKey,
    webhookSecret,
    sessions,
    requests,
    /** The person pays on the session's page: card payments are paid at once. */
    pay: (id) => change(id, { status: "complete", payment_status: "paid", payment_intent: `pi_test_${++count}` }),
    /** The person pays by bank: the session completes unpaid until the payment clears. */
    clearing: (id) => change(id, { status: "complete", payment_status: "unpaid", payment_intent: `pi_test_${++count}` }),
    /** A bank payment clears. */
    cleared: (id) => change(id, { payment_status: "paid" }),
    /** Nobody paid before the page closed. */
    expire: (id) => change(id, { status: "expired" }),
    /**
     * One of Stripe's events about a session, signed as Stripe signs it.
     * @param {string} type
     * @param {Record<string, any>} session
     */
    event(type, session, id = `evt_test_${++count}`) {
      const rawBody = Buffer.from(JSON.stringify({ id, object: "event", type, livemode: false, data: { object: { ...session } } }));
      return { rawBody, signature: signer.webhooks.generateTestHeaderString({ payload: rawBody.toString(), secret: webhookSecret }) };
    },
    close: () => new Promise((resolve) => server.close(resolve))
  };
}
