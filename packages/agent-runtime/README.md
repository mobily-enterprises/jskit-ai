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
| A to-do card in the chat and private job notes, both in the state note at every turn | `planningTools`, `planningNotes` | the app's messages and conversations, through its `planning` store |
| Commands in the workspace; one still running carries on in the background, its whole output a file | `createCommands`, `commandTools` | `agent_commands` |
| Where commands run: gVisor (`runsc`), or a local process for development | `gvisorExecutor`, `localExecutor` | — |
| Files: list, find, search, read in parts, write and edit, never outside the workspace | `fileTools`, `inWorkspace` | — |
| Asking the person: a card with answers to pick from, or in the reply where the chat shows no cards | `askTools`, `askInReplyTools` | — |
| All of these tools for one turn, each left out when what it needs isn't given | `defaultTools` | — |

`migrations/agent_initial.cjs` creates the tables. `agentResources()` describes each one as a table
resource (`agentRuns`, `agentGoals`, `agentSummaries`, `agentSummaryQueue`, `agentCommands`) with
ownership `"system"`: the rows belong to conversations the app guards, the stores reach every
conversation from any server in the owning feature's system context, and the handles refuse any other
context (`SystemContextRequiredError`), a request's or one `forWorkspace` or `forUser` derived, before
any statement. A request reads or changes agent rows only through the stores (`goals.openGoal`,
`summaries.current`, ...), once the app has checked that the caller may see the conversation. A
workspace or user column the app adds to a table does not make it owned: the conversation decides who
sees its rows, and four of the five tables have no such column.
An app adds its own columns with `agentResources({ columns: { goals: { bot_id: { type: "id",
nullable: true } } } })`, then fills them through `owner(row)` for goals or the owner columns of a
claimed run.

## Wiring

One feature of the app owns the agent's tables: it lists `Object.values(agentResources({ columns }))`
in its `owns` and declares a `systemScope`. Its setup hands its handles and its system context
factory to the stores, which reach every conversation from any server, each in a system context
with its own reason. The factories take their collaborators by name, once, at startup:

```js
const agent = { resources, systemContext }; // the owning feature's handles and system context factory
const runs = createRuns(agent);
const goals = createGoals({ ...agent, runs, notices, find, respond, claim: (row) => runs.claim(row.id), record });
const summaries = createSummaries({ ...agent, model, app: "the app", history, notices });
const commands = createCommands({ ...agent, executor: gvisorExecutor() });
```

Each factory checks what it is given before it builds anything: one called the earlier way, with a
Knex (`knex`) and table names (`tables`), or without its handles or `systemContext`, throws a
`TypeError` that names what to pass. `defaultTools`, `planningTools` and `planningNotes` likewise
refuse `knex` and `tables` and check that `planning` has its four methods.

`notices` is optional: `{ publish(channel, key, payload), subscribe(channel, key, listener) }`,
where `subscribe` returns a function that stops listening (PostgreSQL LISTEN/NOTIFY, for example).
With it, a new goal round or a queued summary wakes every server at once; without it, each server
finds due work on its own timer. `goals.start()` and `summaries.start()` run those loops.

For a turn, `defaultTools({ root, commands, planning, conversationId, post, goals:
goals.operationsFor(row) })` gives the agent its tools; `post(messages)` adds cards to the chat and
tells open pages. `planningNotes(planning, conversationId)` gives the state note's to-do list and
notes.

The to-do card and the job notes live in the app's own tables, so the app hands in `planning`
(`AgentPlanning` in `src/server/types.js`), its store for them on the messages and conversations it
owns:

- `currentTodos(conversationId)`: the conversation's newest message of kind `"todos"` whose
  `body.list` is the conversation's id as a string, `{ id, body }`, or undefined;
- `mergeTodos(cardId, body)`: merges `body` into that card's body (PostgreSQL `body || ?::jsonb`);
- `jobNotes(conversationId)`: the conversation's job notes (an array of strings), or null;
- `setJobNotes(conversationId, notes)`: keeps the whole list, an empty one as `[]`.

A new card is a message the tools hand to `post`.

Settings: `AGENT_JOB_COST_USD` (what one job may spend; 5 dollars by default, 0 for none),
`AGENT_RUNSC` (the gVisor binary) and `AGENT_RIPGREP` (ripgrep, with `grep` when it's missing).

## Tests

`npm test` runs every test file. The `*.postgres.test.js` files need a PostgreSQL test database and
skip without one: set `DB_NAME` to the same value as `TEST_DB_NAME`, with the usual `DB_HOST`,
`DB_PORT`, `DB_USER` and `DB_PASSWORD`. Each test makes a schema of its own with only this
package's tables, and drops it afterwards. The gVisor command test also needs `runsc`.
