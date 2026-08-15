---
title: Vibe Guide
description: "The shortest non-technical path into a real AI-first JSKIT app."
---

# Vibe Guide

JSKIT is a framework and a library of strong application patterns. You do not
fill out a framework questionnaire and you do not have to learn its internal
vocabulary before describing a product.

## 1. Start with a product conversation

Create an ordinary Git repository and ask your agent to read the installed
JSKIT skill before starting implementation. Explain what the product is for,
who uses it, and what its first useful version must accomplish.

JSKIT does not create a second blueprint, product-memory system, or seed
questionnaire. Use the request and ordinary project documentation supplied by
the developer's chosen workflow.

## 2. Choose JSKIT explicitly

Choose JSKIT only if it fits the product. Choose MySQL or PostgreSQL explicitly
when the product needs a database. These remain explicit project and dependency
decisions; the agent never selects them silently.

## 3. Realize the application from patterns

The JSKIT skill routes the agent to the generated pattern index. For a normal
browser product it will inspect one of:

- `app/shell-foundation` — responsive application shell, navigation, settings,
  placements, and browser coverage
- `app/minimal-foundation` — smaller Fastify/Vue foundation without the full
  shell

The agent reads the complete pattern, copies or adapts the useful files inside
the existing repository, resolves real collisions, renames the concrete
example, and installs one planned dependency closure. It never creates a
temporary scaffold app or overwrites unrelated project files.

## 4. Add product capabilities deliberately

Authentication, accounts, workspaces, databases, CRUD, console, realtime,
mobile, and assistants are separate capabilities. Add only those selected by
the product. Their package-owned patterns show the public framework APIs and
the app-owned source that belongs around them.

Patterns are examples, not permanent owners. An agent may use one directly,
adapt it, compose it with compatible patterns, or use it as architectural
evidence. No receipt, provenance marker, completion ledger, or hidden
operation history is created.

## 5. Verify the result

Current source is the authority. The agent runs focused tests while working,
then the application verifier, production build, database rebuild in a fresh
disposable database when persistence changed, and Playwright for user-facing
flows. Managed development environments may provide editor, environment,
preview, browser, Git, and credentials; JSKIT also works when the developer
provides those facilities directly.

Useful next reading:

- [Quickstart](/guide/app-setup/quickstart)
- [Application foundations](/guide/app-setup/initial-scaffolding)
- [Authentication](/guide/app-setup/authentication)
- [Database layer](/guide/app-setup/database-layer)
