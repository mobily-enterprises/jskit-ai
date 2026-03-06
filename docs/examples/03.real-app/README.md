# @manual-app/examples-real-app-03

Chapter 3 staged server architecture examples.

This example package includes ten functional providers, one for each chapter stage:

- `ContactProviderStage1`
- `ContactProviderStage2`
- `ContactProviderStage3`
- `ContactProviderStage4`
- `ContactProviderStage5`
- `ContactProviderStage6`
- `ContactProviderStage7`
- `ContactProviderStage8`
- `ContactProviderStage9`
- `ContactProviderStage10`

Each provider exposes two routes with its own stage-specific prefix so all stages can run together.

Example prefixes:

- `/api/v1/docs/ch03/stage-1/...`
- `/api/v1/docs/ch03/stage-10/...`

Use the same request body used in Chapter 3 (`contacts/intake` and `contacts/preview-followup`).
