# Initialize Workflow

Use this when:

- the app state gate resolves to `empty`
- the user explicitly wants a brand-new JSKIT app in a new directory
- or a fresh minimal JSKIT scaffold exists but Stage 1 platform decisions are not settled yet

Safe bootstrap paths:

1. Empty directory path
   - Ask the Stage 1 platform questions first.
   - Once the high-level shape is clear, run `create-app` with the chosen tenancy mode.
2. Fresh scaffold path
   - If the app was just created with `npx @jskit-ai/create-app <app-name>` and `npm install`, treat that scaffold as provisional.
   - Ask the Stage 1 platform questions before adding tenancy-sensitive packages.
   - If the chosen tenancy is `personal` or `workspaces`, write it into `config/public.js` before installing workspace packages.

Important constraint:

- Do not install tenancy-sensitive packages while tenancy is still provisional.
- In practice, that means `workspaces-core` and `workspaces-web` must wait until the Stage 1 tenancy decision is complete.
- A missing `config.tenancyMode` line behaves like `none` at runtime. Treat it as provisional only if no tenancy-sensitive package install has happened yet.

Version 0 sketch:

1. Define the broad app shape before running generators.
2. Capture only the first-round decisions:
   - app purpose
   - tenancy mode: `none`, `personal`, or `workspaces`
   - database engine: MySQL or Postgres
   - auth provider, with Supabase as the default documented path
   - whether the first baseline should include workspaces, realtime, or assistant
3. Once those high-level choices are clear, continue into deeper scoping questions later.

Baseline expectations after initialization:

- create the app scaffold
- install the baseline runtime packages in the documented order
- install dependencies
- run database migrations when the chosen package set requires them
- leave the app in a reproducible, verified baseline state

Do not improvise package order. Use the distributed guide chapters under `guide/agent/app-setup/` or `guide/human/app-setup/`.
