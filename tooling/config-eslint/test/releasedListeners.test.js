import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { releasedListeners } from "../plugin/rules/releasedListeners.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/released-listeners", releasedListeners, {
  valid: [
    "onMounted(() => window.addEventListener(\"resize\", measure));\nonBeforeUnmount(() => window.removeEventListener('resize', measure));",
    "element.addEventListener(\"click\", () => open(), { once: true });",
    "const controller = new AbortController();\nwindow.addEventListener(\"keydown\", onKey, { signal: controller.signal });\nonScopeDispose(() => controller.abort());",
    "const timer = setInterval(tick, 1000);\nonScopeDispose(() => clearInterval(timer));",
    "let observer;\nonMounted(() => { observer ||= new ResizeObserver(measure); observer.observe(root.value); });\nonBeforeUnmount(() => observer?.disconnect());",
    "function startClock() { return setInterval(tick, 1000); }",
    "const stop = socket.on(\"message\", receive);\nonScopeDispose(stop);",
    "uppy.on(\"upload-success\", onUploaded);\nonScopeDispose(() => uppy.off(\"upload-success\", onUploaded));",
    "// readable-check: allow released-listeners - shared resource: the worker listens to its one port for its whole life\nself.addEventListener(\"message\", receive);",
    "function connect(url) {\n  const nextSocket = new WebSocket(url);\n  nextSocket.addEventListener(\"message\", (event) => receive(event));\n  return nextSocket;\n}",
    "const channel = new BroadcastChannel(\"drafts\");\nchannel.addEventListener(\"message\", receive);\nonScopeDispose(() => channel.close());"
  ],
  invalid: [
    {
      code: "window.addEventListener(\"resize\", measure);",
      errors: [{ messageId: "listener", data: { type: "\"resize\"", handler: "measure" } }]
    },
    {
      code: "const controller = new AbortController();\naddEventListener(\"resize\", measure);\nsocket.addEventListener(\"message\", receive);",
      errors: [{ messageId: "listener", data: { type: "\"resize\"", handler: "measure" } }, { messageId: "listener", data: { type: "\"message\"", handler: "receive" } }]
    },
    {
      code: "window.addEventListener(\"resize\", () => measure());\nwindow.removeEventListener(\"resize\", () => measure());",
      errors: [{ messageId: "inlineListener", data: { type: "\"resize\"" } }]
    },
    {
      code: "media.addEventListener(\"change\", update);\nmedia.removeEventListener(\"input\", update);",
      errors: [{ messageId: "listener" }]
    },
    {
      code: "setInterval(tick, 1000);",
      errors: [{ messageId: "interval", data: { kept: "dropped" } }]
    },
    {
      code: "timer = setInterval(tick, 1000);\nclearInterval(otherTimer);",
      errors: [{ messageId: "interval", data: { kept: "kept as timer" } }]
    },
    {
      code: "new ResizeObserver(measure).observe(root);",
      errors: [{ messageId: "observer", data: { observer: "ResizeObserver", kept: "dropped" } }]
    },
    {
      code: "uppy.on(\"upload-success\", onUploaded);",
      errors: [{ messageId: "subscription", data: { method: "on", type: "\"upload-success\"" } }]
    }
  ]
});
