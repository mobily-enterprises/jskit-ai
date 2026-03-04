# @manual-app/examples-real-app-03

Chapter 3 staged server architecture examples.

This example package includes six functional providers, one for each chapter stage:

- `Stage1MonolithProvider`
- `Stage2ControllerProvider`
- `Stage3ServiceProvider`
- `Stage4RepositoryProvider`
- `Stage5ActionProvider`
- `Stage6LayeredProvider`

Each provider exposes two routes with its own stage-specific prefix so all stages can run together.

Example prefixes:

- `/api/v1/docs/ch03/stage-1/...`
- `/api/v1/docs/ch03/stage-6/...`

Use the same request body used in Chapter 3 (`contacts/intake` and `contacts/preview-followup`).
