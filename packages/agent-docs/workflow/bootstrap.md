# Initialize Workflow

Use this only when the app state gate resolves to `empty`, or when the user explicitly wants a brand-new JSKIT app in a new directory.

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
