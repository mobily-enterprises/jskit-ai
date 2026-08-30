---
title: Why JSKIT-AI
description: Strong application capabilities and source patterns for AI-built software.
---

# Strong applications, built with an agent

JSKIT is an AI-first application framework. It provides tested runtime
capabilities and high-quality source patterns for agents to use directly,
adapt deliberately, or learn from.

It is not a scaffolding questionnaire. It does not own a project conversation,
rewrite source through package mutations, or keep receipts of what a generator
once did. The current package graph and source tree are the truth.

## What JSKIT provides

- **Runtime capabilities** for HTTP, actions, database access, authentication,
  users, workspaces, realtime, storage, uploads, console surfaces, and assistant
  features.
- **Public actions** as the canonical operations that HTTP routes, assistants,
  jobs, and tests can invoke through the same contract.
- **Application patterns** containing complete, tested examples for foundations,
  shells, feature packages, CRUDs, auth surfaces, workspace surfaces, and other
  recurring structures.
- **Stable extension seams** for capabilities, actions, events, routes,
  placements, resources, and client components.
- **Agent guidance** that routes an implementation agent to the smallest
  relevant APIs and examples without taking ownership of the agent host.

## What the application owns

The application owns its product decisions, package choices, source,
configuration, environment, migrations, tests, and deployment. An agent may
copy a JSKIT example unchanged, modify it for the product, or write a smaller
implementation using the same public APIs.

JSKIT does not require a general CLI. Install packages with npm, inspect their
metadata and patterns, write normal source, and run ordinary app-owned scripts.

## The design test

A new agent should be able to understand the installed capabilities, find a
close source pattern, implement one coherent feature, and verify it without
learning a hidden generator protocol. A human should be able to inspect the
same source and reach the same conclusions.

That is the point of JSKIT-AI: strong repetitive patterns without repetitive
framework ceremony.

- [Read the guide](/guide/)
- [Start with an application foundation](/guide/app-setup/initial-scaffolding)
- [Browse every source pattern](/patterns/)
- [See how JSKIT is AI ready](/ai-ready)
- [Using JSKIT with an external agent host](/vibe-guide)
