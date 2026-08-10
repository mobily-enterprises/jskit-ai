# Application operations

Read this reference for application creation, CLI discovery, package changes,
and generator selection.

## Create an application

Confirm the application name and tenancy mode, then run:

```bash
npx @jskit-ai/create-app <app-name> --tenancy-mode <tenancy-mode>
cd <app-name>
npm install
```

Generated applications require Node.js 26. Use `--target . --force` only to
promote a known JSKIT `ai-seed` directory, never to overwrite an arbitrary
application. Use `--minimal` only for a deliberately bare package-development
or unusual integration baseline. After creation, follow the generated
`AGENTS.md`.

Do not add authentication, users, workspaces, console, example routes, sample
records, or another database adapter unless the request requires them.

## Select and apply technology

- Inspect available capabilities with `npx jskit list` and inspect a specific
  entry with `npx jskit show <id> --details`.
- Install reusable runtime capability with `npx jskit add package <id>`.
- Inspect a bundle before installing it with `npx jskit add bundle <id>`.
- Run tooling packages with
  `npx jskit generate <generator> <action> ...`; do not install generators as
  runtime packages.
- Let `jskit` own JSKIT application mutations, use `npm install` for dependency
  installation, and use `npm run db:migrate` for database migrations.
- Review generated files and continue only at documented app-owned seams.

Packages own reusable framework behavior. Generators create application-owned
pages, components, placements, migrations, and support files. Prefer the
narrowest installed package or generator that implements the requested
vertical slice; do not build a parallel local framework around it.
