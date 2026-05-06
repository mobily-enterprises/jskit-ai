---
title: Vibe Guide
description: "The shortest non-technical path into a real JSKIT app."
---

# Vibe Guide

This page is for people who want to build with an AI agent without learning JSKIT first.

You do not need to know the framework words. You only need to:

1. start the seed workspace
2. describe the app in normal language
3. answer a few setup questions when the agent asks

## 1. Start the seed workspace

Open a terminal and run:

```bash
npx @jskit-ai/create-app testapp --template ai-seed
cd testapp
```

That creates a tiny starter folder with one file for the AI to read. It is not the real app yet. That is intentional.

## 2. Tell the AI what you want in normal language

You do not need to know JSKIT terms like tenancy, surfaces, placements, providers, or generators.

Just explain things in human terms, for example:

- what the app should help people do
- who will use it
- whether people should sign in
- whether each customer, business, or team should have its own private area
- whether you want a staff or admin back office
- whether you want AI features now, later, or not at all

Example:

> I want a dog grooming booking app. Customers should be able to book appointments. Staff should manage bookings and customer notes. Each business should have its own private area. People should sign in. I want a simple admin area. AI features can wait until later.

If you do not know the technical words, say that plainly. The agent should translate your goals into the setup it needs.

## 3. What the AI will probably ask you

The AI should turn your description into a few practical choices, such as:

- is this a simple app, a normal account-based app, or a team/workspace app?
- should people sign in?
- should the app save data in a database?
- do you want AI features?

If you do not know which database or sign-in system to use, ask for the standard recommendation.

If you do not have a strong reason to choose differently, asking for the standard JSKIT path and MySQL is the safest starting point today.

## 4. What information you may need to provide

Once the AI starts setting up the app, it may need some local development values from you.

Common examples:

- local database details
- sign-in provider project details
- an AI API key if you want AI features now

In this flow, those are local setup values for your development environment. They are not the same thing as production launch secrets.

One important point: if the app needs a database, the AI should make sure the database really exists before moving on. If it does not exist yet, the AI should help you stop and sort that out first instead of pretending the setup is done.

## 5. What happens next

Once the AI has enough answers, it upgrades the seed folder into a real JSKIT app, installs what it needs, and then continues from the normal app instructions.

You do not need to manage that handoff manually.

## 6. How to keep the process sane

Ask the AI to work in small steps.

Good habits:

- ask it to do one feature or one chunk at a time
- ask it to show you the result in the browser after each chunk
- ask it to explain technical choices in plain English if you do not understand them
- do not accept "done" until it has run the project checks
- if it changed screens or user flows, ask it to run the browser test for that too

You do not need to memorize the JSKIT command names for those checks. The agent should know them.

## 7. When you want the technical version

This page is intentionally simple.

If you want the exact technical command sequences or the deeper framework explanation, use:

- [Quickstart](/guide/app-setup/quickstart) for the larger standard stack
- [Initial Scaffolding](/guide/app-setup/initial-scaffolding) for the base scaffold and the smaller starting stack
- [Working With The JSKIT CLI](/guide/app-setup/working-with-the-jskit-cli) for maintenance, health checks, and review commands
