---
title: "Recipe: a study of how useful the app is"
description: Check how useful a JSKIT app is for what people come to do, judging value and gaps rather than ease of use, ending in ranked recommendations and changing nothing.
---

# Study how useful `<APP_NAME>` is for what people come to do: ranked recommendations, nothing changed

Check how well `<APP_NAME>` serves what people come to it for: whether each
kind of person can get their job done inside the app from start to finish,
what they still have to do elsewhere, what the app knows but never gives back,
and what it could do for them without being asked. The study changes nothing.
It ends in recommendations ranked by value, each with its evidence, the
smallest change that delivers it and the JSKIT owner or recipe that builds it.

## When to propose it

- "Is this app any good?", "what's missing?", "what should we build next?",
  "how can it be more useful?", "review the product".
- "People sign up and don't come back", "people still use a spreadsheet next
  to it".
- After a big feature lands, to see what the app now lacks around it.

## How to answer the person

Propose the simple way first: "I'll go through `<APP_NAME>` as each kind of
person who uses it, on realistic test data, check what they come to do and
whether the app lets them finish it, and come back with a ranked list of what
would make it more useful. I won't change anything." This judges value and
gaps, not ease of use: how easy each step is belongs to the user experience
pass ([User experience pass](/guide/framework/ux-pass)), which can follow.

Then say: "There are other options if you want to discuss." They are talking
to real users or reading how the app is really used (the person's data and
their consent decide that), comparing with the products people use instead
(the person names them), or a user experience pass when the problem is that
things are hard to do rather than missing.

## Product decisions (defaults)

- The people are the kinds the Blueprint names (in a Genesis project), else
  the app's roles (`roleCatalog` in `config/roles.js`), else signed-out
  visitors and signed-in users.
- Each kind of person has three to seven jobs they come to do, written as the
  outcome they want ("know which invoices are overdue"), not as a screen.
- A recommendation's rank is its value to those people, times how many of
  them it reaches and how often, against what it costs to build and run.
- Evidence comes from realistic seeded test data and the code, never the
  development database or real outside services.

## Make a careful saved plan first

The study's own plan, saved before it starts and ticked as it goes:

1. Write who the app is for and their jobs, from the Blueprint, the front
   page and the help; ask the person only what nothing says.
2. Map what the app offers: the main navigation (`shell.primary-nav`
   placements), the pages under `src/pages`, the server features' actions and
   routes, the roles and permissions, what goes out (email, exports, links)
   and what comes in (imports, integrations in `integrations.json`).
3. For each job, walk it end to end as that person on the test target with
   realistic data (a Playwright script, or the app's preview on its test
   database). Note where it finishes, where it stops, what the person must
   do outside the app, what information is missing at the moment they decide,
   and what the app makes them repeat.
4. Find the gaps: jobs with no path, half paths, data the app holds but never
   shows back (totals, history, what changed), moments it could act for the
   person (a reminder, a summary, a nudge), work shared with other people it
   doesn't support, and features no job needs.
5. Check what holds at a realistic size: a list that cannot be searched or
   filtered at hundreds of rows is a gap in value, not in ease of use.
6. Rank the recommendations and write the plan this page's last section
   describes.

## Technical details

Where a JSKIT app keeps what the study reads:

- **What people can reach:** main tasks are `shell.primary-nav` placements
  and each inner page declares `jskit.parent`
  ([Where people find each task](/guide/framework/ux-pass#where-people-find-each-task));
  the account menu is the `auth.profile-menu` placement and settings
  sections are `account-settings:sections` placements.
- **What the app can do:** each server feature's actions (one
  `create<Name>Actions` each) and routes
  ([Typed features](/guide/framework/typed-features#actions)); CRUD features
  ([CRUD operations](/guide/framework/crud-operations)).
- **What it knows:** each table resource (`defineTableResource`) and its
  `searchSchema`, which says what a list can be searched and filtered by
  ([Data access](/guide/framework/data-access#layer-1-the-table-resource)).
- **What it does on its own:** `jskit check` lists every system scope, the
  background work the app runs
  ([Background work](/guide/framework/data-access#background-work)).
- **Who may do what:** `roleCatalog` and its permissions
  ([Role permissions](/guide/app-setup/multi-homing#role-permissions)).
- **What goes out:** email and SMS through `deliverMessage`, other outside
  effects through `logSideEffect`
  ([Environments](/guide/framework/environments#the-application-s-own-side-effects)).

A recommendation names the JSKIT owner or recipe that would build it, for
example the [installable app](/guide/recipes/installable-app),
[reminders and digests](/guide/recipes/reminders-and-digests),
[file uploads and images](/guide/recipes/file-uploads-and-images),
[inviting people with roles](/guide/recipes/invite-people-with-roles),
[payments and subscriptions](/guide/recipes/payments-and-subscriptions),
[another language](/guide/recipes/another-language) or
[working offline](/guide/recipes/offline-study).

## Proof

Each finding carries its evidence: a walk on the test target with realistic
seeded data (the step where the job stops), the file and line that shows what
exists or is missing, or a measurement. Nothing runs against development data
or a real outside service. The study changes nothing: at its end the working
tree holds only the saved plan.

## The plan it ends in

Ranked recommendations, saved where the project keeps plans, most valuable
first. Each one says:

- the people and the job it serves, and how often they do it;
- the gap, with its evidence;
- the smallest change that closes it, and the JSKIT owner or recipe that
  builds it;
- what it costs to build and to run;
- how the person will know it worked (a job that now finishes in the app, a
  step people no longer do elsewhere).

It ends with what the study could not judge without the person or real users.

## Leftovers for the person

- Whether the jobs are the right ones, when nothing in the project says.
- What real users say and do, if the person can ask them or share usage.
- Which recommendations to build, in what order, against their budget.
