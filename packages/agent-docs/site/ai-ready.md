---
title: AI Ready
description: How JSKIT gives coding agents strong, inspectable implementation material.
---

# AI ready by design

JSKIT is useful to an agent because its architecture is explicit in installed
packages and ordinary source—not because a framework-specific agent workflow
stands between the agent and the code.

## Packages declare the runtime

Each JSKIT package declares the capabilities it provides and requires, its
server and client providers, its public exports, and its pattern assets. The
kernel resolves that graph directly from installed packages.

An agent can therefore answer concrete questions:

- Which package owns this capability?
- Which provider creates it?
- Which public action performs the operation?
- Which pattern shows the intended application shape?
- Which package owns the migration or UI contribution?

## Patterns replace generators

The valuable part of old scaffolding was the accumulated design knowledge in
its templates. JSKIT preserves that knowledge as readable `PATTERN.md` assets
with complete example files.

Patterns are not immutable generated output. An agent may:

- use an example unchanged when it fits;
- adapt it to product terminology and boundaries;
- take only the relevant fragment;
- compare existing code with it during review or cleanup.

There is no questionnaire, mutation engine, ownership receipt, or replay
ledger. Git shows what changed; tests show whether it works.

## Actions are the public operation boundary

A JSKIT action is a named product or platform operation with explicit input,
dependencies, authorization, and output. HTTP routes, assistants, jobs, and
tests should call the same action instead of duplicating business logic.

This gives agents a small, stable map of what the application can do while
keeping implementation in normal functions and feature modules.

## Stable identifiers are not a service locator

JSKIT keeps identifiers where identity matters: capability ids, action ids,
event ids, routes, placements, resources, and component registrations.
Application code does not fetch arbitrary services from a container by string,
symbol, class, or object token. Dependencies are explicit values captured when
features and providers are assembled.

## The agent host remains independent

JSKIT supplies documentation, skills, patterns, and runtime APIs. It does not
own the product blueprint, editor, chat session, preview process, environment
store, or deployment system. Those may come from Genesis, Vibe64, another
agent host, or a developer working directly in a terminal.

## Verification is ordinary engineering

Agents should use focused unit and integration tests, rebuild disposable
databases from migrations, exercise relevant browser behavior, and run the
application's normal verification script. JSKIT does not create a parallel
receipt or evidence system.

The result is deliberately boring: installed packages, inspectable source,
documented patterns, explicit capabilities, ordinary Git, and tests.
