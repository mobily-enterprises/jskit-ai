import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { compileScript, parse } from "@vue/compiler-sfc";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";

const controlUrl = new URL("../src/client/conversation/AssistantGoalControl.vue", import.meta.url).href;
const textUrl = new URL("../src/client/i18n.js", import.meta.url).href;

const TEXT_SOURCES = Object.freeze({
  // Each text shows as its key, with any parameters.
  keys: "export function useJskitText() { return { t: (key, params) => params ? `${key}(${Object.values(params).join(\"=\")})` : key }; }",
  // The real English texts, as en.json words them.
  english: `const texts = ${readFileSync(new URL("../locales/en.json", import.meta.url), "utf8")};
export function useJskitText() {
  return { t: (key, params = {}) => key.split(".").reduce((value, part) => value?.[part], texts)
    .replace(/\\{(\\w+)\\}/gu, (_match, name) => String(params[name])) };
}`
});

/** The control, compiled with its texts from one of TEXT_SOURCES. */
async function importControl(texts = "keys") {
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      const [file, query = ""] = url.split("?");
      const source = new URLSearchParams(query).get("text");
      if (file === textUrl && source) return { format: "module", shortCircuit: true, source: TEXT_SOURCES[source] };
      if (file !== controlUrl || !source) return nextLoad(url, context);
      const { descriptor } = parse(readFileSync(new URL(file), "utf8"));
      const compiled = compileScript(descriptor, { id: "assistant-goal-chip", inlineTemplate: true }).content;
      return { format: "module", shortCircuit: true, source: compiled.replace('from "../i18n.js"', `from "../i18n.js?text=${source}"`) };
    }
  });
  try {
    return (await import(`${controlUrl}?text=${texts}`)).default;
  } finally {
    hooks.deregister();
  }
}

const slotted = tag => defineComponent({ setup: (_props, { slots }) => () => h(tag, slots.default?.()) });

/** The chip (the menu's activator) and the details panel of one goal state. */
async function render(control, goal, state = {}) {
  const app = createSSRApp({ render: () => h(control, { state: { enabled: true, goal, pause() {}, resume() {}, cancel() {}, ...state } }) });
  app.component("VMenu", defineComponent({ setup: (_props, { slots }) => () => h("div", [
    h("div", { class: "chip" }, slots.activator?.({ props: {} })), h("div", { class: "panel" }, slots.default?.())
  ]) }));
  app.component("VBtn", slotted("button"));
  app.component("VCard", slotted("div"));
  app.component("VTextarea", defineComponent({ render: () => null }));
  app.component("VTextField", defineComponent({ render: () => null }));
  const html = await renderToString(app);
  const chip = /<div class="chip">([\s\S]*?)<\/div><div class="panel">/u.exec(html)[1];
  const panel = html.slice(html.indexOf('<div class="panel">'));
  return { chip, label: /<span class="assistant-goal__label">([^<]*)<\/span>/u.exec(chip)[1], panel };
}

const startedTwoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
// Two hours spent working, sampled ten minutes ago.
const worked = { elapsedSeconds: 2 * 60 * 60, sampledAt: Date.now() - 10 * 60 * 1000 };

test("a paused, blocked or waiting goal's chip says so and shows no running clock; its details keep the running time", async () => {
  const control = await importControl();
  for (const [status, key] of [["paused", "jskit.assistant.goal.paused"], ["blocked", "jskit.assistant.goal.blocked"],
    ["usageLimited", "jskit.assistant.goal.usageLimited"], ["budgetLimited", "jskit.assistant.goal.budgetLimited"]]) {
    const { chip, label, panel } = await render(control, { objective: "Finish every check", status, createdAt: startedTwoHoursAgo, ...worked },
      { working: true });
    assert.equal(label, key, `a ${status} goal's chip names its state`);
    assert.doesNotMatch(chip, /assistant-goal__elapsed|assistant-goal__light--running/u, `a ${status} goal's chip shows no clock`);
    assert.match(panel, /jskit\.assistant\.goal\.elapsed\(jskit\.assistant\.goal\.runningTime=2:00:00\)/u,
      `a ${status} goal's details keep the running time, without the time since`);
  }
});

test("an active goal looks running, with its clock counting on from its running time, only while its conversation works on it", async () => {
  const control = await importControl();
  const goal = { objective: "Finish every check", status: "active", createdAt: startedTwoHoursAgo, ...worked };
  const running = await render(control, goal, { working: true });
  assert.equal(running.label, "jskit.assistant.goal.goal");
  assert.match(running.chip, /<span class="assistant-goal__elapsed" aria-hidden="true">2:10:0\d<\/span>/u);
  assert.match(running.chip, /assistant-goal__light--running/u);
  assert.match(running.panel, /role="status">jskit\.assistant\.goal\.running</u);
  // Between turns, or after a restart before its continuation starts, nothing
  // works on it: the chip says so, with no red light and no clock, and its
  // running time stays where the work stopped.
  const idle = await render(control, goal);
  assert.equal(idle.label, "jskit.assistant.goal.notRunning");
  assert.doesNotMatch(idle.chip, /assistant-goal__elapsed|assistant-goal__light--running/u);
  assert.match(idle.panel, /jskit\.assistant\.goal\.runningTime=2:00:00\)/u);
  assert.match(idle.panel, /jskit\.assistant\.goal\.notRunningHint</u);
  assert.match(idle.panel, /jskit\.assistant\.goal\.pause</u, "a goal that is not running can still be paused");
  // The reason it stopped (a restart's continuation that failed) shows with it.
  const failed = await render(control, goal, { error: "The goal could not continue. Vibe64 tries again shortly." });
  assert.equal(failed.label, "jskit.assistant.goal.notRunning");
  assert.match(failed.panel, /role="alert"[^>]*>The goal could not continue\. Vibe64 tries again shortly\.</u);
  // A goal with no running time shows no clock rather than counting wall time.
  const untimed = await render(control, { objective: "Finish every check", status: "active", createdAt: startedTwoHoursAgo }, { working: true });
  assert.doesNotMatch(untimed.chip, /assistant-goal__elapsed/u);
  assert.doesNotMatch(untimed.panel, /runningTime/u);
  const complete = await render(control, { objective: "Finish every check", status: "complete", ...worked });
  assert.equal(complete.label, "jskit.assistant.goal.goal");
  assert.doesNotMatch(complete.chip, /assistant-goal__elapsed/u);
  assert.match(complete.panel, /runningTime=2:00:00\)/u);
  const none = await render(control, null);
  assert.equal(none.label, "jskit.assistant.goal.set");
});

test("a goal stopped at its AI account's limit says so in a few words; its details say when the limit resets and what to do", async () => {
  const control = await importControl();
  const reset = new Date();
  reset.setSeconds(0, 0);
  const time = `${String(reset.getHours()).padStart(2, "0")}:${String(reset.getMinutes()).padStart(2, "0")}`;
  const waiting = { objective: "Finish every check", status: "usageLimited", createdAt: startedTwoHoursAgo, resetsAt: reset.getTime() / 1000 };
  // Claude's goals can be paused while they wait; the chip shows no clock.
  const claude = await render(control, waiting, { pauseBlocked: true });
  assert.equal(claude.label, "jskit.assistant.goal.usageLimited");
  assert.doesNotMatch(claude.chip, /assistant-goal__elapsed|assistant-goal__light--running|usageLimitedUntilHint/u);
  assert.match(claude.chip, /assistant-goal__light--paused/u, "a goal stopped at its limit shows the paused light");
  assert.match(claude.panel, /role="status">jskit\.assistant\.goal\.usageLimited</u);
  assert.match(claude.panel, new RegExp(`jskit\\.assistant\\.goal\\.usageLimitedUntilHint\\(${time}\\)<`, "u"));
  for (const action of ["pause", "resume", "cancel"]) {
    assert.match(claude.panel, new RegExp(`jskit\\.assistant\\.goal\\.${action}<`, "u"), `a waiting Claude goal offers ${action}`);
  }
  // Codex refuses Pause while it waits, so its control offers only Resume and Cancel.
  const codex = await render(control, waiting);
  assert.doesNotMatch(codex.panel, /jskit\.assistant\.goal\.pause</u);
  assert.match(codex.panel, /jskit\.assistant\.goal\.resume</u);
  // A reset on another day names its day, in the details.
  const later = await render(control, { ...waiting, resetsAt: waiting.resetsAt + 3 * 24 * 60 * 60 });
  assert.equal(later.label, "jskit.assistant.goal.usageLimited");
  assert.match(later.panel, new RegExp(`usageLimitedUntilHint\\(${new Date((waiting.resetsAt + 3 * 24 * 60 * 60) * 1000)
    .toLocaleDateString(undefined, { weekday: "short" })} ${time}\\)<`, "u"));
  // Without a reset time it waits for the person; out of credit says what to do, in the details.
  const unknown = await render(control, { ...waiting, resetsAt: undefined });
  assert.equal(unknown.label, "jskit.assistant.goal.usageLimited");
  assert.match(unknown.panel, /jskit\.assistant\.goal\.usageLimitedHint</u);
  const credit = await render(control, { ...waiting, resetsAt: undefined, outOfCredit: true }, { pauseBlocked: true });
  assert.equal(credit.label, "jskit.assistant.goal.outOfCredit");
  assert.match(credit.panel, /jskit\.assistant\.goal\.outOfCreditHint</u);
  assert.match(credit.panel, /jskit\.assistant\.goal\.resume</u);
});

// The chip sits beside the message box, on a phone too: each of its labels is a
// few words, and anything longer (why, until when, what to do) is in the details.
const CHIP_LABEL_MAX_CHARACTERS = 24;

test("every goal chip label is a few words, while the details explain a stop in full", async () => {
  const control = await importControl("english");
  const reset = Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60;
  const goal = { objective: "Finish every check. ".repeat(40), createdAt: startedTwoHoursAgo, ...worked };
  const states = [
    ["no goal", null, {}],
    ["loading", null, { loading: true }],
    ["unavailable", null, { available: false, error: "The goal could not be read. Wait for the assistant connection and try again." }],
    ["starting", null, { action: "set" }],
    ["running", { ...goal, status: "active" }, { working: true }],
    ["not running after an error", { ...goal, status: "active" }, { error: "Goal continuation after restart failed: the AI is busy. Vibe64 tries again shortly." }],
    ["paused", { ...goal, status: "paused" }, {}],
    ["blocked", { ...goal, status: "blocked", reason: "An explanation of the blocker. ".repeat(40) }, {}],
    ["at its usage limit", { ...goal, status: "usageLimited", resetsAt: reset }, { pauseBlocked: true }],
    ["at its usage limit with no reset time", { ...goal, status: "usageLimited" }, { pauseBlocked: true }],
    ["out of credit", { ...goal, status: "usageLimited", outOfCredit: true }, { pauseBlocked: true }],
    ["at its token budget", { ...goal, status: "budgetLimited" }, {}],
    ["complete", { ...goal, status: "complete" }, {}]
  ];
  for (const [name, value, state] of states) {
    const { chip, label, panel } = await render(control, value, state);
    assert.ok(label.length <= CHIP_LABEL_MAX_CHARACTERS, `a goal ${name} has a short chip label, not "${label}"`);
    // The chip's visible text (its tooltip may say more).
    const shown = chip.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim();
    assert.doesNotMatch(shown, /Finish every check|explanation of the blocker|tries again|could not be read/u, `a goal ${name} keeps its text out of the chip`);
    if (state.error) assert.match(panel, /role="alert"/u, `a goal ${name} shows its error in the details`);
  }
  const limited = await render(control, { ...goal, status: "usageLimited", resetsAt: reset }, { pauseBlocked: true });
  assert.equal(limited.label, "Goal paused: usage limit");
  assert.match(limited.panel, /The AI account reached its usage limit, which resets at [^.]+\. The goal does not continue by itself: choose Resume goal once it resets\./u);
  const credit = await render(control, { ...goal, status: "usageLimited", outOfCredit: true }, { pauseBlocked: true });
  assert.equal(credit.label, "Goal paused: no credit");
  assert.match(credit.panel, /The AI account is out of credit\. The goal does not continue by itself: top up or switch AI account, then choose Resume goal\./u);
});
