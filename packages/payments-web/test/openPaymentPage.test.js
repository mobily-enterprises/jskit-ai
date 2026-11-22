import assert from "node:assert/strict";
import test from "node:test";
import { openPaymentPage } from "../src/client/openPaymentPage.js";

// A page's window as openPaymentPage uses it: framed or not, with a browser that opens new tabs or blocks them.
function page({ framed, blocks = false, crossOriginParent = false }) {
  const calls = [];
  const self = {};
  const opened = { opener: self };
  return {
    calls,
    opened,
    self,
    get top() {
      if (crossOriginParent) throw new DOMException("Blocked a frame with origin", "SecurityError");
      return framed ? {} : self;
    },
    location: { assign: (url) => calls.push(["assign", url]) },
    open: (...args) => {
      calls.push(["open", ...args]);
      return blocks ? null : opened;
    }
  };
}

const CHECKOUT = "https://checkout.stripe.com/c/pay/cs_test_a1";

test("an unframed page goes to the payment page in its own tab", () => {
  const unframed = page({ framed: false });
  assert.equal(openPaymentPage(CHECKOUT, unframed), "redirected");
  assert.deepEqual(unframed.calls, [["assign", CHECKOUT]]);
});

test("a framed page opens the payment page in a new tab, cutting the new tab's opener itself", () => {
  const framed = page({ framed: true });
  assert.equal(openPaymentPage(CHECKOUT, framed), "opened");
  assert.deepEqual(framed.calls, [["open", CHECKOUT, "_blank"]], "no window features: noopener would make every open look blocked");
  assert.equal(framed.opened.opener, null);

  const behindOtherOrigin = page({ framed: true, crossOriginParent: true });
  assert.equal(openPaymentPage(CHECKOUT, behindOtherOrigin), "opened", "a parent the page may not read is a frame too");
});

test("a framed page whose new tab is blocked says so, for a control that opens it on a click", () => {
  const blocked = page({ framed: true, blocks: true });
  assert.equal(openPaymentPage(CHECKOUT, blocked), "blocked");
  assert.deepEqual(blocked.calls, [["open", CHECKOUT, "_blank"]]);
});

test("only an http(s) payment page opens", () => {
  const unframed = page({ framed: false });
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "not a url"]) {
    assert.throws(() => openPaymentPage(url, unframed), TypeError, url);
  }
  assert.deepEqual(unframed.calls, []);
});
