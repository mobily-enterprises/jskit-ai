# Changelog

## Unreleased

- Every factory fails at startup when called the earlier way, naming what to pass instead: `createRuns`, `createGoals`, `createSummaries` and `createCommands` refuse `knex`, `tables` and `table`, and assert the agent-table handles they read through (`resources.agentRuns`, `agentGoals`, `agentSummaries` and `agentSummaryQueue`, `agentCommands`) and `systemContext`, pointing to the feature that owns `agentResources()`; `defaultTools` and `planningTools` refuse `knex` and `tables`, and they and `planningNotes` check that `planning` has `currentTodos`, `mergeTodos`, `jobNotes` and `setJobNotes`. A missing handle used to fail at the first statement, and `planningNotes(knex, ...)` on the first turn.
