# Child CRUD Layout Patterns

Use when:

- planning nested CRUDs
- adding records under a parent record
- deciding whether child records need their own page or stay inside the parent view

Rules:

- Before generating a child CRUD, ask how the user wants the child records laid out.
- Do not assume one layout pattern by default.

Clarify these options:

- embedded in the parent view
  - often a list rendered directly inside the parent page
- embedded as child subroutes
  - the parent page becomes a routed container or subpage host
- totally separate route/page
  - the child list/view/edit flow lives in its own route area

Why this matters:

- the answer changes route structure, placements, host containers, and which generator flow fits best
- child CRUD layout mistakes are expensive to unwind later

Avoid:

- generating nested CRUD routes before the parent/child layout is agreed
