import { CLIENT_GUIDE_URL, compactText, createReporter, keyName, ruleMeta } from "../support.js";

const OBSERVERS = new Set(["ResizeObserver", "MutationObserver", "IntersectionObserver", "PerformanceObserver"]);
const SUBSCRIBERS = new Set(["on", "addListener", "subscribe"]);
const UNSUBSCRIBERS = new Set(["off", "removeListener", "removeAllListeners", "unsubscribe"]);
const FUNCTION_TYPES = new Set(["ArrowFunctionExpression", "FunctionExpression"]);

function calleeName(node) {
  const callee = node.callee;
  return callee.type === "Identifier" ? callee.name : callee.type === "MemberExpression" && !callee.computed ? callee.property.name : "";
}

// An event type as written, one quote style: "resize" and 'resize' are one type.
function eventType(sourceCode, node) {
  return node.type === "Literal" && typeof node.value === "string" ? JSON.stringify(node.value) : compactText(sourceCode, node);
}

// Whether a listener releases itself: `{ once: true }`, or `{ signal }` from an AbortController aborted at teardown.
function releasesItself(options) {
  return options?.type === "ObjectExpression" &&
    options.properties.some((property) => property.type === "Property" && ["once", "signal"].includes(keyName(property)));
}

// The name a started timer or observer is kept under, its result handed back to the caller, or "" when it is dropped.
function keptAs(sourceCode, node) {
  const parent = node.parent;
  if (parent.type === "VariableDeclarator" && parent.init === node) {
    return compactText(sourceCode, parent.id);
  }
  if (parent.type === "AssignmentExpression" && parent.right === node) {
    return compactText(sourceCode, parent.left);
  }
  if (["ReturnStatement", "ArrowFunctionExpression", "Property", "ArrayExpression", "CallExpression"].includes(parent.type)) {
    return "handed back";
  }
  return "";
}

// The object a listener is added to, as written, or "" for a bare call (the window).
function listenedObject(sourceCode, node) {
  return node.callee.type === "MemberExpression" ? compactText(sourceCode, node.callee.object) : "";
}

// Everything client code starts, it stops: each addEventListener has its
// removeEventListener for the same handler, each setInterval its clearInterval,
// each observer its disconnect, and each `.on()` whose release is dropped its
// `.off()`. A listener registered with `{ once }` or an AbortSignal releases
// itself, and one on an object this file creates with `new` (its own socket)
// goes with that object. The release normally sits in onScopeDispose or
// onBeforeUnmount.
const releasedListeners = Object.freeze({
  meta: ruleMeta("Require every listener, interval, observer and subscription client code starts to be released in the same file.", {
    listener: "addEventListener({{type}}, {{handler}}) is never removed. Remove it at teardown (onScopeDispose or onBeforeUnmount), or pass { once } or an AbortSignal.",
    inlineListener: "addEventListener({{type}}, …) takes an inline handler, which no removeEventListener can match. Name the handler and remove it at teardown.",
    interval: "setInterval() {{kept}} is never cleared. Keep its id and clear it at teardown.",
    observer: "{{observer}} {{kept}} is never disconnected. Disconnect it at teardown.",
    subscription: ".{{method}}({{type}}) drops its release and no .off() matches it. Keep what it returns, or remove the handler at teardown."
  }, "released-listeners", CLIENT_GUIDE_URL),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "released-listeners");
    const listeners = [];
    const removed = [];
    const intervals = [];
    const cleared = new Set();
    const observers = [];
    const disconnected = new Set();
    const subscriptions = [];
    const unsubscribed = [];
    // The names objects this file creates are kept under: their listeners are dropped with them.
    const owned = new Set();
    return {
      CallExpression(node) {
        const name = calleeName(node);
        const [first, second, third] = node.arguments;
        if (name === "addEventListener" && first && second && !releasesItself(third)) {
          listeners.push({ node, target: listenedObject(sourceCode, node), type: eventType(sourceCode, first), handler: second });
        } else if (name === "removeEventListener" && first && second) {
          removed.push({ type: eventType(sourceCode, first), handler: compactText(sourceCode, second) });
        } else if (name === "setInterval") {
          intervals.push({ node, kept: keptAs(sourceCode, node) });
        } else if (name === "clearInterval" && first) {
          cleared.add(compactText(sourceCode, first));
        } else if ((name === "disconnect" || name === "unobserve") && node.callee.type === "MemberExpression") {
          disconnected.add(compactText(sourceCode, node.callee.object));
        } else if (SUBSCRIBERS.has(name) && node.callee.type === "MemberExpression" && first && node.parent.type === "ExpressionStatement" &&
          (name === "subscribe" || second)) {
          subscriptions.push({ node, target: listenedObject(sourceCode, node), method: name, type: eventType(sourceCode, first) });
        } else if (UNSUBSCRIBERS.has(name) && node.callee.type === "MemberExpression") {
          unsubscribed.push({ method: name, type: first ? eventType(sourceCode, first) : "" });
        }
      },
      NewExpression(node) {
        if (node.callee.type === "Identifier" && OBSERVERS.has(node.callee.name)) {
          observers.push({ node, observer: node.callee.name, kept: keptAs(sourceCode, node) });
        } else if (!["", "handed back"].includes(keptAs(sourceCode, node))) {
          owned.add(keptAs(sourceCode, node));
        }
      },
      "Program:exit"() {
        for (const { node, target, type, handler } of listeners) {
          if (owned.has(target)) {
            continue;
          }
          if (FUNCTION_TYPES.has(handler.type)) {
            report(node, "leaked-listener", "inlineListener", { type });
          } else if (!removed.some((entry) => entry.handler === compactText(sourceCode, handler) && entry.type === type)) {
            report(node, "leaked-listener", "listener", { type, handler: compactText(sourceCode, handler) });
          }
        }
        for (const { node, kept } of intervals) {
          if (kept !== "handed back" && !cleared.has(kept)) {
            report(node, "leaked-listener", "interval", { kept: kept ? `kept as ${kept}` : "dropped" });
          }
        }
        for (const { node, observer, kept } of observers) {
          if (kept !== "handed back" && !disconnected.has(kept)) {
            report(node, "leaked-listener", "observer", { observer, kept: kept ? `kept as ${kept}` : "dropped" });
          }
        }
        for (const { node, target, method, type } of subscriptions) {
          const released = owned.has(target) || unsubscribed.some((entry) => entry.method === "removeAllListeners" || entry.method === "unsubscribe" || entry.type === type);
          if (!released) {
            report(node, "leaked-listener", "subscription", { method, type });
          }
        }
      }
    };
  }
});

export { releasedListeners };
