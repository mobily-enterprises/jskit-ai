import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";

// The agent's own tables as table resources. Each row belongs to a conversation, which the app
// defines and guards, and the stores reach every conversation from any server, so the tables'
// ownership is "system": only the owning feature's system context reaches them, and a request's
// context, or one derived for a workspace or a user, is refused before any statement. A column the
// app adds (a workspace or user id on goals) changes nothing: the app checks the conversation, then
// calls the stores. Fields are named as their columns, so the stores answer the rows they always
// answered.

// A table whose key is the conversation's id: the resource's id is that column.
// Every handle filters it by id (filters: { id }), one id or a list.
const CONVERSATION_KEY = Object.freeze({ type: "id", primary: true, required: true, storage: Object.freeze({ column: "conversation_id" }) });
const TEXT = Object.freeze({ type: "string", noTrim: true });
const OPTIONAL_TEXT = Object.freeze({ type: "string", noTrim: true, nullable: true });
const TIME = Object.freeze({ type: "dateTime" });
const OPTIONAL_TIME = Object.freeze({ type: "dateTime", nullable: true });
const COUNT = Object.freeze({ type: "integer" });

// Filters that compare with the database's clock, as every server shares it.

/** Runs whose server stopped beating `seconds` ago or more. */
function staleFor(query, seconds, { column }) {
  query.whereRaw("?? < now() - make_interval(secs => ?)", [column("heartbeat_at"), seconds]);
}

/** Runs with steps saved. */
function withSteps(query, _withSteps, { column }) {
  query.whereNotNull(column("steps"));
}

/** Goal rounds queued for now or earlier, and held by no server's live lease. */
function roundDue(query, _due, { column }) {
  query.whereNotNull(column("round_at")).whereRaw("?? <= now()", [column("round_at")]);
  query.where((lease) => lease.whereNull(column("lease_until")).orWhereRaw("?? < now()", [column("lease_until")]));
}

/** Queued summaries due now, and held by no server's live lease. */
function summaryDue(query, _due, { column }) {
  query.whereRaw("?? <= now()", [column("run_after")]);
  query.where((lease) => lease.whereNull(column("lease_until")).orWhereRaw("?? < now()", [column("lease_until")]));
}

// Each table's own fields, as the stores read them back (the app's columns are added to these).
const RUN_FIELDS = Object.freeze({
  id: CONVERSATION_KEY,
  started_at: TIME,
  heartbeat_at: TIME,
  steps: Object.freeze({ type: "array", nullable: true }),
  input: Object.freeze({ type: "object", nullable: true })
});
const GOAL_FIELDS = Object.freeze({
  conversation_id: Object.freeze({ type: "id", search: true }),
  objective: TEXT,
  status: Object.freeze({ ...TEXT, search: true }),
  rounds: COUNT,
  max_rounds: COUNT,
  reason: OPTIONAL_TEXT,
  time_zone: TEXT,
  language: TEXT,
  round_at: OPTIONAL_TIME,
  lease_until: OPTIONAL_TIME,
  attempts: COUNT,
  created_at: TIME,
  updated_at: TIME
});
const SUMMARY_FIELDS = Object.freeze({
  conversation_id: Object.freeze({ type: "id", search: true }),
  // The summary this one follows, the conversation's newest when it was saved; null for its first.
  follows: Object.freeze({ type: "id", nullable: true }),
  covers_up_to: Object.freeze({ type: "id" }),
  summary: TEXT,
  messages: COUNT,
  created_at: TIME
});
const SUMMARY_QUEUE_FIELDS = Object.freeze({
  id: CONVERSATION_KEY,
  requested_at: TIME,
  run_after: TIME,
  lease_until: OPTIONAL_TIME,
  attempts: COUNT,
  last_error: OPTIONAL_TEXT
});
const COMMAND_FIELDS = Object.freeze({
  conversation_id: Object.freeze({ type: "id", search: true }),
  why: TEXT,
  script: TEXT,
  status: TEXT,
  exit_code: Object.freeze({ type: "integer", nullable: true }),
  output: TEXT,
  truncated: Object.freeze({ type: "boolean" }),
  server: TEXT,
  heartbeat_at: TIME,
  started_at: TIME,
  ended_at: OPTIONAL_TIME
});

/**
 * How the stores turn each resource's records back into rows (repositories/rows.js): its own
 * fields' types, and the column its id is.
 */
export const AGENT_ROWS = Object.freeze({
  runs: Object.freeze({ schema: RUN_FIELDS, idProperty: "conversation_id" }),
  goals: Object.freeze({ schema: GOAL_FIELDS }),
  summaries: Object.freeze({ schema: SUMMARY_FIELDS }),
  summaryQueue: Object.freeze({ schema: SUMMARY_QUEUE_FIELDS, idProperty: "conversation_id" }),
  commands: Object.freeze({ schema: COMMAND_FIELDS })
});

/**
 * The agent's table resources, by resource name, for the feature that owns them: list them in its
 * `owns`, and hand the handles its setup receives to the stores. `columns` adds the app's own
 * columns to a table, as fields named as their columns (`{ goals: { bot_id: { type: "id",
 * nullable: true } } }`); the stores answer them as the handles do.
 * @param {{ columns?: Partial<Record<keyof typeof AGENT_ROWS, Record<string, object>>> }} [options]
 */
export function agentResources({ columns = {} } = {}) {
  return Object.freeze({
    agentRuns: defineTableResource({
      name: "agentRuns",
      tableName: "agent_runs",
      ownership: "system",
      idProperty: "conversation_id",
      schema: { ...RUN_FIELDS, ...columns.runs },
      searchSchema: {
        staleFor: { type: "number", applyFilter: staleFor },
        withSteps: { type: "boolean", applyFilter: withSteps }
      }
    }),
    agentGoals: defineTableResource({
      name: "agentGoals",
      tableName: "agent_goals",
      ownership: "system",
      schema: { ...GOAL_FIELDS, ...columns.goals },
      searchSchema: {
        statusIn: { type: "array", actualField: "status", filterOperator: "in" },
        roundDue: { type: "boolean", applyFilter: roundDue }
      }
    }),
    agentSummaries: defineTableResource({
      name: "agentSummaries",
      tableName: "agent_summaries",
      ownership: "system",
      schema: { ...SUMMARY_FIELDS, ...columns.summaries }
    }),
    agentSummaryQueue: defineTableResource({
      name: "agentSummaryQueue",
      tableName: "agent_summary_queue",
      ownership: "system",
      idProperty: "conversation_id",
      schema: { ...SUMMARY_QUEUE_FIELDS, ...columns.summaryQueue },
      searchSchema: {
        summaryDue: { type: "boolean", applyFilter: summaryDue }
      }
    }),
    agentCommands: defineTableResource({
      name: "agentCommands",
      tableName: "agent_commands",
      ownership: "system",
      schema: { ...COMMAND_FIELDS, ...columns.commands }
    })
  });
}
