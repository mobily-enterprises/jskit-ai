# @jskit-ai/agent

A working agent loop on the AI SDK: call the model, run the tools it asks for, feed the results
back, until it answers. Around that loop sit the choices that make it finish real jobs: reasoning
on every step, retries, room inside a long turn, checks on every reply, and summaries sized for a
1-million-token window. It has no tables; the opt-in `@jskit-ai/agent-runtime` adds saved runs,
goals, background summaries and coding tools.

The bar it was built to: *"our agentic loop must be NOTHING short of Claude's own"*, for agents that
create software. This document says what the loop does, every decision behind it and why, how it
was measured and how good it is. Keep it current when the loop changes. `docs/deepseek-harness.md`
is the study of DeepSeek Harness (about 165 design choices) the loop was designed from.

```js
import { chatModel, createTool, runLoop } from "@jskit-ai/agent/server";
import { z } from "zod";

const model = chatModel({ apiKey, model: "deepseek-ai/DeepSeek-V4.1-Flash", baseURL });
const tools = {
  lookUp: createTool({
    id: "look_up",
    description: "Look a word up in the dictionary.",
    inputSchema: z.object({ word: z.string() }),
    execute: ({ word }) => dictionary.find(word)
  })
};
const { text, transcript, unfinished } = await runLoop({
  model, name: "Helper", instructions, history, tools, maxSteps: 40
});
```

---

## 1. Status in one page

| | |
|---|---|
| **Results** (Together AI, everything in) | shared coding 45/45, hard coding 15/15, app building 15/15 (in a group too), recall after a ~600k-token chat 5/5, quick chat 10/10 in 1–2 s |
| **Against the bar** | Claude Code running the same DeepSeek model: 15/15 shared, 5/5 hard. The loop matches it on every task measured. DeepSeek's own harness: 44/45 shared; the loop passes it. |
| **Before this work** | shared 40/45, failure-prone cases 64/70, every group request for an app failed |
| **Speed** | quick chat 0–1 s; coding tasks 2–25 s; the loop's own overhead per reply 0.05–0.2 s, the rest is the model |
| **Cost** | about half a US cent per coding task on Together; 65–95% of input tokens come from the cache |
| **Open** | a mid-turn summary (deferred until a long build shows the need) |

---

## 2. How a reply runs

Every reply (a person's own chat, a room, a group, a request from another agent, a routine, an app
task) goes through **one loop**: `runLoop`, on the AI SDK's `generateText` (or `streamText` with
`onText`). The app around it chooses the history, the tools and what to do with the result.

```
person's message
  └─ the app's reply
       ├─ history: summary + messages since (summarise first if past 550k)   §5
       ├─ state note: time, accounts, routines, open to-do list, job notes   §6
       ├─ tools for this turn (+ repeat reminder, + mid-reply messages)      §7
       ├─ runLoop()
       │    ├─ every step reasons (adaptive)                                 §3
       │    ├─ old tool results give way past 700k inside the turn           §5
       │    ├─ each finished step can be saved (onStep, onSteps)             §8
       │    └─ out of steps or time → account of where it got to             §8
       ├─ checks after the reply (each can send it back once):               §9
       │    raw markup · stopped short · claimed files · unsupported claims
       ├─ cleaning: no markup, no bracketed notes                            §9
       └─ unfinished? → a goal, carried on in rounds by itself               §8
```

### Where the code is

| What | File |
|---|---|
| The loop, the system prompt in each format, the stored transcript | `src/server/loop.js` |
| The chat model in either format, reasoning settings, retries, one-shot calls | `src/server/model.js` |
| Tools as plain objects, the schema the model is shown | `src/server/tool.js`, `schema.js` |
| History within budget, the summary note, room inside a long turn, clipped old results | `src/server/context.js` |
| Reply checks: leaked markup, stopping short, the tool record, unsupported claims | `src/server/checks.js` |
| Summaries without tables: where to cut, what the summariser reads, folding the previous one | `src/server/summaries.js` |
| Repeat reminders and messages heard mid-reply | `src/server/turn.js` |
| Token estimates, reading in parts, same gist, bracketed notes | `src/server/text.js` |
| Saved runs and the resumer, goals, background summaries, to-do list and notes, coding tools | `@jskit-ai/agent-runtime` |

---

## 3. The model and how it's called

- **Model:** DeepSeek V4.1 Flash, 1,048,576-token window (`WINDOW_TOKENS`), through **Together AI**
  by default, in the OpenAI style (`@ai-sdk/deepseek`).
- **Format:** with `anthropicURL` (DeepSeek's own API), `chatModel` calls the model in the
  **Anthropic format** (`@ai-sdk/anthropic`), exactly as Claude Code calls it: signed reasoning sent
  back on every step, adaptive thinking at high effort, a 32,000-token output cap.
- **Reasoning:** on for **every step of every loop**, adaptive, so the model spends a lot on a hard
  bug and almost nothing on "hi" (`REASONING.on`). One-shot side calls (rule matching, summaries,
  activity lines, the claims checker) don't reason (`REASONING.off`); a call that builds something
  may.
- **Retries:** the AI SDK retries a failed call 6 times (`MODEL_RETRIES`), waiting 2, 4, 8… seconds
  (about two minutes in all), longer than DeepSeek Harness's five quick tries.
- **Output cap:** 32,000 tokens for loop steps (`LOOP_OUTPUT_TOKENS`; the Anthropic format needs
  one, and its default is 4,096).
- **System prompt:** one message in the OpenAI style, parts joined by a blank line; separate blocks
  in the Anthropic format. Instructions, then the summary, then the state note.

## 4. What the agent is told

The instructions are the app's, but what was learned writing them belongs with the loop:

- **No narration.** Instructions that said "keep the person informed" and asked for status lines
  made DeepSeek announce a step and **end its turn**. Tell the model that the person sees what it's
  doing while it works, so it should call the tools straight away and keep going until the job is
  done. Status lines people rely on can stay, as tool fields.
- **A to-do list** for any job of more than three steps; **job notes** in long jobs.
- **Files:** send existing files with a tool, never claim an attachment, never write internal
  paths; name files by content; scratch in `/tmp`.

## 5. Context: using the 1M window without forgetting

| Where | What happens | Numbers |
|---|---|---|
| Between turns | the conversation is summarised in the background, recall first, keeping the newest part word for word (`SUMMARY_LIMITS`; the store is agent-runtime's) | summarise past **450k** tokens, keep **125k** (up to 200 turns), summary up to 8,000 tokens |
| Before a reply | if summarising fell behind, the reply **summarises first** instead of cutting (`compactMessages`) | past **550k** |
| Last resort | if summarising fails, the oldest messages give way, **and the model is told** (`withinBudget`) | past **600k** |
| Inside one turn | the oldest tool results become a one-line note ("run the tool again if you need it"), never the newest 20; once left out they stay out, so the cache keeps hitting (`trimOldResults`) | past **700k**, down to **500k** |
| Old results in history | a long tool result from an earlier turn is clipped (`clipOldResult`) | 6,000 characters |
| Each tool result | command output shows its first and last 8,000 characters; the **whole output is a file**; files are read in parts (`textPart`) | parts of 120,000 characters; whole outputs up to 16 MB |
| The prompt's start | instructions, then summary, then history; the state note just before the last message | 65–95% of input cached |

## 6. Keeping things in mind

- **To-do list** (`update_todos` in agent-runtime): one card in the chat, updated in place; the
  open list is in the state note at every turn. Agents chose to keep one in 10 of 14 hard runs.
- **Job notes** (`keep_notes`): the agent's private notes for the job, in the state note at every
  turn, never shown in the chat.
- **Goals** (`create_goal`, `get_goal`, `update_goal`): a multi-step job keeps going in rounds until
  it's complete, blocked (not before round 3), at 24 rounds, or at its cost limit.

## 7. Talking to it while it works

What the person writes during a reply reaches the model **with its next tool result**
(`hearWhileWorking`), so it changes course at once, and that reply then counts as the answer. The
**3rd, 5th and 8th identical tool call** in a row gets a reminder in its result (`remindOnRepeat`).

## 8. Long jobs and staying alive

- **Steps saved as they happen:** `onStep` hears each finished step, so the app can save it
  (agent-runtime's `createRuns`). If the server stops, a page retry or the **resumer** on any server
  carries the reply on from its last step (as Claude Code resumes from its transcript), unless the
  person has written since.
- **Never "ask me to carry on":** a reply that runs out of steps or time (15 minutes,
  `AGENT_REPLY_MINUTES`) says where it got to and returns `unfinished`; the app opens a goal for the
  request and the rounds carry it on in the background. With `carriesOn`, the account says the work
  continues.
- **Limits, said plainly in the chat:** 24 rounds, and a **cost limit per job**,
  `AGENT_JOB_COST_USD` (default 5 dollars, 0 for none).
- **Stop:** aborting `signal` ends the run at once with the signal's reason.

## 9. Truthful replies

Each check below can send a reply back **once**, carrying on from its own steps
(`withoutClosingWords`: the second pass sees the first one's work, so nothing is redone).

| Check | Catches |
|---|---|
| **Raw markup** (`LEAKED_MARKUP`) | a tool call written as text, DeepSeek's tokens (`<｜begin▁of▁sentence｜>`), budget and safety tags |
| **Stopped short** (`stoppedShort`) | a reply under 600 characters that ends by announcing its next step; any agent with tools, groups too (with a goal active, its round carries on instead) |
| **Claimed files** | "attached below" with no file sent (the app's check, by words) |
| **Unsupported claims** (`unsupportedClaims`) | a reply that reports actions is compared with what its tools actually did (`toolRecord`), in one short call; "emailed it to Sam" with no email is sent back |

And always: **no raw markup** (`withoutMarkup`) and **no bracketed bookkeeping notes**
(`stripNotes`) in what people see.

An app can add its own: a builder agent that saves a draft only when the draft passes the app's own
checks, and only scripts whose tests pass.

---

## 10. Decisions, and why

| # | Decision | Why |
|---|---|---|
| 1 | Build our own loop (first on Mastra, on the AI SDK since), studying DeepSeek Harness rather than depending on it | DSH is a preview with ~80 packages; its designs are MIT and documented in `docs/deepseek-harness.md`. The move off Mastra kept every request byte for byte |
| 2 | Measure first: fixed tasks judged by outcome, baseline before changes | so every change is proven by numbers |
| 3 | Claude Code's own loop is the bar | "NOTHING short of Claude's own" |
| 4 | Drop narration instructions | measured cause of "announce and stop" (60/60 without, 53/60 with) |
| 5 | Reasoning on every step, adaptive | reasoning on; adaptive keeps chat at 0–1 s |
| 6 | DeepSeek's own API in Claude Code's format, as an option | 70/70 and cached; Together stays the default |
| 7 | Together stays the provider | with the loop changes it scores 70/70 there too |
| 8 | Size everything for 1M | "keep in mind that we have ONE MILLION context" |
| 9 | Never forget unseen | summarise first; say so if anything is cut |
| 10 | Trim old tool results inside a turn rather than summarise mid-turn | the same "leave out, re-read when needed" idea as Claude Code; the gist stays in the model's words, notes and to-do list. A mid-turn summary waits for a real need |
| 11 | Whole command outputs as files | as Claude Code keeps large outputs: the agent can grep and tail them; on storage every server shares |
| 12 | Save steps as they happen; resume on any server | Claude Code survives being killed; servers are disposable |
| 13 | Messages mid-reply reach the model at its next step | conversations *while* it's doing things |
| 14 | To-do list as a live card; job notes private | the person sees the plan; notes complete it |
| 15 | No subagents yet | with 1M tokens the main reason (a small window) mostly goes; they bring cost and risk |
| 16 | A cost limit per job, as a setting | a limit, but a parameter |
| 17 | Truthful replies, fully built | replies that claim work not done were the worst failures |
| 18 | A long job carries on by itself | the person is never asked to say "carry on" |
| 19 | One loop for groups too | groups gained the deadline, the account and trimming |

What didn't work, or wasn't needed:
- **Not sending reasoning back** on Together: helped (64 to 68 of 70) but wasn't the answer; the
  narration and stop-short fixes were.
- **Together's Anthropic endpoint:** 70/70, but no prompt cache and unsigned reasoning.
- **Removing every tool's acknowledgement field:** it broke status lines people relied on, so only
  the instruction changed.
- **Our own retry code:** removed; the libraries already retry.

---

## 11. How it was measured

The loop was measured inside the first app built on it, with its own runners: a real reply through
the whole pipeline (every tool, the state note, the checks), against a test database, with the real
model; and the same shared cases through DeepSeek Harness, for reference. Judges are hidden from the
agent: they're copied in only after it finishes. Folder cases judge the files; app cases judge the
apps, tables and records; chat cases judge the words. Every hard case was checked against a
reference solution (passes) and against the shipped files (fails). Variants compared: as shipped,
quiet, minimal tools, no reasoning sent back, Together's Anthropic endpoint, DeepSeek's endpoint as
Claude Code calls it, DeepSeek in the OpenAI style, and thinking off.

### The cases

**Shared coding (15):** each gets a folder; the judge checks the result.

| Case | The job | Judged on |
|---|---|---|
| big-file-edit | change one helper in a 1,200-line module, nothing else | the helper's new behaviour, every other line untouched |
| bug-fix | fix two bugs in `money.py` so its tests pass | hidden tests of the documented behaviour |
| contacts-extract | pull emails and Australian phone numbers from messy text | exact normalised, sorted lists; no versions or prices |
| crash-debug | make a crashing stats script skip bad values | both commands' exact output |
| csv-summary | totals per region across three CSVs | `summary.csv` against the expected totals |
| date-ranges | merge touching and overlapping booking ranges, with tests | hidden tests including invalid input |
| fix-js-bugs | fix two JavaScript files so `npm test` passes | hidden tests |
| four-deliverables | a script, its tests, its output and a README | all four exist and are right |
| json-flatten | flatten nested orders into CSV lines | exact rows and totals |
| log-report | top IPs and 5xx counts from a 60,000-line log | `report.json` against the expected answer |
| notes-needle | three facts hidden in 40 meeting notes | the facts and the files they're in |
| refactor-js | rename a function everywhere and add a discount parameter, with tests | hidden tests; the old name gone |
| sqlite-questions | four questions about a SQLite shop database | exact answers |
| textstats | word counts and top words, with own tests | hidden tests (apostrophes, ties) |
| todo-cli | a planned command-line to-do app with subprocess tests | hidden CLI tests (ids never reused, errors) |

**Hard coding (5):** longer, trickier jobs where loops fall over.

| Case | The job | Judged on |
|---|---|---|
| calc | build a calculator language (precedence, power, variables, functions, exact error positions) from a 17-test spec, no eval | the spec plus hidden programs and errors |
| billing | "March invoices are wrong": three bugs across modules (CSV thousands, month end, tiers) that only show when run | every invoice regenerated and exact |
| notes-api | a JSON HTTP API with validation, filters and persistence, plus tests | the server started and probed over HTTP, including a restart |
| async-migration | convert four callback modules and their tests to async/await, a test per error case | hidden async tests, no callbacks left, `npm test` passes |
| dedupe-perf | make a quadratic dedupe fast (under 10 s on 60,000 rows) without changing output for any input | output identical to the original on 30 tricky random inputs, the sample, and the big file in time |

**App building (5):** a throwaway workspace, the agent as its builder: a new app with a table and a
form, a new field shown on a list, a tested rule that refuses bad records, records added by name,
and the first of these asked in a group chat. Judged on the tables, apps, scripts and records, and
on the app's own checks passing.

**Quick chat (5):** a greeting, 15% of 84, three bakery names, a friendlier rewrite, a 20-minute
dinner idea. Judged on a sensible answer; timed.

**Memory (1):** a 2.4M-character chat (about 600k tokens) with five facts in its older part (a
birthday, a café name, a plumber's name and visit, a budget, an allergy), asked for all five. Judged
on a written summary plus all five facts; facts the agent saved elsewhere are cleared so they can't
answer for the summary.

### Results over time (Together unless noted)

| Run | Shared | Failure-prone (7 × 10) | Hard | Apps |
|---|---|---|---|---|
| DeepSeek Harness, reference | 44/45 | — | — | — |
| Baseline, before changes | 40/45 | — | — | 7/12 |
| Reasoning from the first step | 43/45 | 53/60 (6 cases) | — | 11/12 |
| No narration | 44/45 | 60/60 (6 cases), 64/70 | — | 12/12 |
| Format test: DeepSeek's endpoint, Claude Code's way | — | 70/70 | 9/10 | 12/12 |
| Whole loop on Together | 45/45 | 70/70 | 14/15, then 15/15 | 15/15 |
| With the final-reply check | 30/30 | — | — | 10/10 |
| With commands in gVisor | 30/30 | — | 5/5 | 5/5 |

**References on the same tasks:** Claude Code with Sonnet 15/15 shared; Claude Code with DeepSeek
(the same model) 15/15 shared and 5/5 hard, 97.8% of its input cached.

---

## 12. How good is it

**Strong:**
- On every task measured, it matches Claude Code running the same model, and passes DeepSeek's own
  harness.
- The failures that mattered are gone: announcing a step and stopping, raw markup, claiming work
  that wasn't done, losing a reply when a server stops, and forgetting old conversation.
- It's built for apps with several disposable servers, beyond what Claude Code needs: any server
  can resume any reply, jobs carry on unattended in rounds, and everything is in PostgreSQL or on
  shared storage.

**Not yet proven:**
- **Very long builds.** The tasks run from seconds to a few minutes. A real multi-hour build, where
  in-turn trimming and summaries matter most, hasn't been measured; that's where a mid-turn summary
  might turn out to be needed.
- **Breadth.** About 30 tasks. They're varied and judged strictly, but small next to real use.
- **The final-reply check's hit rate.** Its prompts aren't stored, so it's known to cause no
  failures but not how often it fires.

**Costs:** the final-reply check adds about 1–2 s to replies that report actions; everything else
around the model costs about 0.05–0.2 s a reply.

## 13. Keeping it good

- Rerun the suites after any change to the loop, instructions or tools: shared, hard and app
  building three times each, chat and memory once. No case may get worse without an explanation.
- Add a case for every failure seen in real use, with a hidden judge checked against a reference
  solution.
- Every model-facing string, prompt, reasoning setting and tool definition is part of the measured
  behaviour: change one only with a rerun. The package tests (`npm test`) cover the pure parts.
