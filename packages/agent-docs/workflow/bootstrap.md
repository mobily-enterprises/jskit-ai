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
   - Once a baseline package stack is chosen, assume its standard package-owned workflows unless the developer asks for overrides.

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
3. Treat Stage 1 as a package-stack decision, not a blank-slate workflow design exercise.
4. Once those high-level choices are clear, continue into deeper scoping questions later.

Ask setup values plainly:

- Only ask for setup values that correspond to the modules or packages already chosen for the baseline.
- When the next package install needs concrete local development values, ask for them directly using the exact env var names or option names.
- Do not hide behind vague requests for "credentials" or "values after that boundary".
- If MySQL or Postgres is selected, confirm that the target database already exists before the runtime install, or that the developer has enough local admin or create-database access to create it now.
- Do not proceed as if `DB_NAME` alone means the database is ready. The actual database must exist before the database runtime install and migration flow can be treated as valid.
- In this workflow, these are routine setup inputs:
  - If the MySQL runtime is selected: `DB_NAME`, `DB_USER`, `DB_PASSWORD`
  - If the MySQL host or port differs from the local default `127.0.0.1:3306`: `DB_HOST`, `DB_PORT`
  - If Supabase auth is selected: `AUTH_SUPABASE_URL`, `AUTH_SUPABASE_PUBLISHABLE_KEY`
  - If browser-facing auth callbacks are relevant: confirm whether `APP_PUBLIC_URL` should stay `http://localhost:5173`
- Ask in plain language and continue once the developer provides the values.

Baseline expectations after initialization:

- create the app scaffold
- install the baseline runtime packages in the documented order
- install dependencies
- run database migrations when the chosen package set requires them
- use the standard packaged workflows that come with those packages unless the blueprint records an override
- leave the app in a reproducible, verified baseline state

Do not improvise package order. Use the distributed guide chapters under `guide/agent/app-setup/` or `site/guide/app-setup/`.
