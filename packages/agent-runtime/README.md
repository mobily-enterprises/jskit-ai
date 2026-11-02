# @jskit-ai/agent-runtime

The opt-in parts of `@jskit-ai/agent`, for an app that adds them on purpose: the agent's own
PostgreSQL tables (saved runs, goals, background summaries, commands) and its coding tools (files,
commands in gVisor or a local process, a to-do list and notes, goals, asking the person). The loop
itself, and why it works as it does, is in `@jskit-ai/agent`'s README.

## What it adds

| What | Export | Table |
|---|---|---|
| Each finished step saved while a reply runs; one a stopped server left is taken over by another | `createRuns`, `startResumer` | `agent_runs` |
| Goals: a long job carries on by itself in rounds until it's complete, blocked or at a limit | `createGoals`, `goalTools`, `roundPrompt` | `agent_goals` |
| Summaries between turns, in the background, claimed by one server | `createSummaries` | `agent_summaries`, `agent_summary_queue` |
| A to-do card in the chat and private job notes, both in the state note at every turn | `planningTools`, `planningNotes`, `currentTodos` | the app's messages and conversations (`PLANNING_TABLES`) |
| Commands in the workspace; one still running carries on in the background, its whole output a file | `createCommands`, `commandTools` | `agent_commands` |
| Where commands run: gVisor (`runsc`), or a local process for development | `gvisorExecutor`, `localExecutor` | — |
| Files: list, find, search, read in parts, write and edit, never outside the workspace | `fileTools`, `inWorkspace` | — |
| Asking the person: a card with answers to pick from, or in the reply where the chat shows no cards | `askTools`, `askInReplyTools` | — |
| All of these tools for one turn, each left out when what it needs isn't given | `defaultTools` | — |

`migrations/agent_initial.cjs` creates the tables. Each factory takes the names it uses, so an app
can rename them or add its own columns (`owner(row)` for goals, extra columns on a claimed run).

## Wiring

The factories take their collaborators by name, once, at startup:

```js
const runs = createRuns({ knex });
const goals = createGoals({ knex, runs, notices, find, respond, claim: (row) => runs.claim(row.id), record });
const summaries = createSummaries({ knex, model, app: "the app", history, notices });
const commands = createCommands({ knex, executor: gvisorExecutor() });
```

`notices` is optional: `{ publish(channel, key, payload), subscribe(channel, key, listener) }`,
where `subscribe` returns a function that stops listening (PostgreSQL LISTEN/NOTIFY, for example).
With it, a new goal round or a queued summary wakes every server at once; without it, each server
finds due work on its own timer. `goals.start()` and `summaries.start()` run those loops.

For a turn, `defaultTools({ root, commands, knex, conversationId, post, goals:
goals.operationsFor(row) })` gives the agent its tools; `post(messages)` adds cards to the chat and
tells open pages.

Settings: `AGENT_JOB_COST_USD` (what one job may spend; 5 dollars by default, 0 for none),
`AGENT_RUNSC` (the gVisor binary) and `AGENT_RIPGREP` (ripgrep, with `grep` when it's missing).

## Tests

`npm test` runs every test file. The `*.postgres.test.js` files need a PostgreSQL test database and
skip without one: set `DB_NAME` to the same value as `TEST_DB_NAME`, with the usual `DB_HOST`,
`DB_PORT`, `DB_USER` and `DB_PASSWORD`. Each test makes a schema of its own with only this
package's tables, and drops it afterwards. The gVisor command test also needs `runsc`.
