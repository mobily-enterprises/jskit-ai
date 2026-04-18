# Database layer

At the end of the previous chapter, the app could already authenticate real users through Supabase, but JSKIT was still using its no-database fallback for the app-side user mirror. In this chapter, we install the MySQL database runtime, add the migration tooling, and explain what that changes immediately and what it still does **not** change yet.

This chapter is more infrastructural than the previous ones. That is intentional. There is no dramatic new screen in the browser. The important change is that the app gains a real database layer that later packages can depend on.

## Recap from previous chapters

To get back to the same starting point as the end of the previous chapter, run:

```bash
SUPABASE_URL=...
SUPABASE_KEY=...

npx @jskit-ai/create-app exampleapp --tenancy-mode none
cd exampleapp
npm install

npx jskit add package shell-web
npx jskit add package auth-provider-supabase-core \
  --auth-supabase-url "$SUPABASE_URL" \
  --auth-supabase-publishable-key "$SUPABASE_KEY" \
  --app-public-url "http://localhost:5173"

npx jskit add bundle auth-base
npm install
```

If you are already continuing from the previous chapter, you are already in the right place and can skip that setup.

<DocsTerminalTip label="MySQL" title="Create The Database First">
Before installing the database runtime, make sure a real MySQL database already exists and that you know its connection details.

At minimum, keep these ready:

- host
- port
- database name
- database user
- database password

JSKIT installs the database runtime and writes those values into `.env`, but it does **not** create the MySQL server for you and it does **not** create the database itself.

If you are working locally, a very typical starting point is:

- host: `localhost`
- port: `3306`
- database name: `exampleapp`
- user: `exampleapp`
</DocsTerminalTip>

## Installing the database runtime

From inside `exampleapp`, run:

```bash
DB_HOST=localhost
DB_PORT=3306
DB_NAME=exampleapp
DB_USER=exampleapp
DB_PASSWORD=secret

npx jskit add package database-runtime-mysql \
  --db-host "$DB_HOST" \
  --db-port "$DB_PORT" \
  --db-name "$DB_NAME" \
  --db-user "$DB_USER" \
  --db-password "$DB_PASSWORD"
npm install
```

The first command adds the MySQL driver package and its generic JSKIT database runtime dependency, using the explicit connection values from those `DB_*` variables:

- database host
- database port
- database name
- database user
- database password

The second command downloads the newly referenced runtime packages and the underlying Node dependencies, especially `knex` and `mysql2`.

If you open the app in the browser after this install, it still looks the same. That is expected.

- `/home` still renders the same shell
- `/auth/login` still renders the same login screen

This chapter changes the server-side infrastructure of the app, not the visible shell.

## What changes immediately

Installing `database-runtime-mysql` gives the app three important things right away.

### A real database runtime

The server can now build a real Knex client from environment variables. That gives later packages a standard way to ask for a database connection instead of each package inventing its own wiring.

### A migration workflow

The app now gets three new scripts in `package.json`:

```json
{
  "scripts": {
    "db:migrate": "knex --knexfile ./knexfile.js migrate:latest",
    "db:migrate:rollback": "knex --knexfile ./knexfile.js migrate:rollback",
    "db:migrate:status": "knex --knexfile ./knexfile.js migrate:list"
  }
}
```

That is the first time the scaffold can talk about schema migrations in a standard way.

### A place for future schema files

The app also gets a top-level `migrations/` directory. Right now it only contains `.gitkeep`, which can look underwhelming at first, but that empty directory is actually useful. It means the migration toolchain is ready even before any package installs real schema files.

That is the key idea of this chapter:

- the database runtime provides the **infrastructure**
- later packages provide the **actual schema**

## What this still does not change yet

Installing the database runtime is important, but it is not the same thing as installing the full users/account data model.

Right now, after this chapter:

- the app can resolve database settings from `.env`
- the server can create a Knex client
- the app can run migration commands
- later packages are allowed to depend on `runtime.database`

But the app still does **not** have:

- JSKIT user tables
- JSKIT user settings tables
- persistent account/profile rows on the JSKIT side
- workspace tables
- CRUD tables of its own

That means authentication is still only **partly** database-backed.

- Supabase is still the real source of truth for auth users and sessions.
- JSKIT still has a database runtime available.
- But JSKIT still has **no installed package yet** that tells auth to switch from the standalone in-memory profile mirror to the persistent users-backed one.

So this chapter is an infrastructure step. It makes the database layer available, but it does not yet install the package that uses that layer for persistent JSKIT-side user data.

<DocsTerminalTip label="Important" title="Auth Is Still In Standalone Mode">
This is the most important thing to keep straight:

- adding `database-runtime-mysql` does **not** automatically make the auth chapter's temporary mirror disappear
- it also does **not** create JSKIT user rows yet

That only changes later, when a package such as `users-core` is installed and tells auth to use the persistent users-backed profile sync mode.

So after this chapter the app has a database layer, but authentication still behaves like:

- real Supabase auth
- temporary JSKIT-side mirror

not yet:

- real Supabase auth
- persistent JSKIT-side users layer
</DocsTerminalTip>

## Under the hood

The interesting files for this chapter are mostly at the top level:

```text
exampleapp/
  .env
  knexfile.js
  migrations/
    .gitkeep
  package.json
```

This is the first chapter where the new behavior is mostly about server infrastructure rather than pages or client layouts.

### `package.json` gains database dependencies and scripts

After installing the MySQL runtime, the important new pieces in `package.json` look like this:

```json
{
  "dependencies": {
    "@jskit-ai/database-runtime": "0.x",
    "@jskit-ai/database-runtime-mysql": "0.x",
    "knex": "^3.1.0",
    "mysql2": "^3.11.2"
  },
  "scripts": {
    "db:migrate": "knex --knexfile ./knexfile.js migrate:latest",
    "db:migrate:rollback": "knex --knexfile ./knexfile.js migrate:rollback",
    "db:migrate:status": "knex --knexfile ./knexfile.js migrate:list"
  }
}
```

Those new dependencies divide into two roles:

- `@jskit-ai/database-runtime` is the generic JSKIT database runtime
- `@jskit-ai/database-runtime-mysql` is the MySQL-specific driver package
- `knex` is the database toolkit used by both runtime code and migration commands
- `mysql2` is the actual Node driver that speaks to MySQL

The three new scripts are also worth reading carefully:

- `db:migrate` applies all pending migrations
- `db:migrate:rollback` rolls back the last migration batch
- `db:migrate:status` lists applied and pending migrations

They are not special JSKIT commands. They are ordinary project scripts, which makes them easy to run in any environment.

### `.env` now owns the database connection settings

The package install also writes the database settings into `.env`:

```dotenv
DB_CLIENT=mysql2
DB_HOST=localhost
DB_PORT=3306
DB_NAME=exampleapp
DB_USER=exampleapp
DB_PASSWORD=secret
```

That small block is doing two jobs.

- `DB_CLIENT` tells the generic database runtime which dialect was installed.
- the rest of the variables describe the real connection to MySQL.

This matters because the generic runtime is written to support more than one driver package. The runtime does not hard-code MySQL. It reads the configured client and the installed driver and checks that they agree.

### `knexfile.js` is for migration commands, not normal page code

The migration scripts in `package.json` work because the app now has a top-level `knexfile.js`:

```js
import path from "node:path";
import dotenv from "dotenv";
import {
  normalizeText,
  toKnexClientId,
  resolveDatabaseClientFromEnvironment,
  resolveKnexConnectionFromEnvironment
} from "@jskit-ai/database-runtime/shared";

const appRoot = process.cwd();
dotenv.config({
  path: path.join(appRoot, ".env"),
  quiet: true
});

const dialectId = resolveDatabaseClientFromEnvironment(process.env);
const client = toKnexClientId(dialectId);
const defaultPort = dialectId === "pg" ? 5432 : 3306;
const migrationsDirectory = path.resolve(appRoot, normalizeText(process.env.DB_MIGRATIONS_DIR) || "migrations");

export default {
  client,
  connection: resolveKnexConnectionFromEnvironment(process.env, {
    client: dialectId,
    defaultPort,
    context: "knex migrations"
  }),
  migrations: {
    directory: migrationsDirectory,
    extension: "cjs"
  }
};
```

The important thing to understand is what this file is **for**.

It is not the main runtime API that your app code imports during a request. It is the configuration file the Knex CLI reads when you run commands such as:

```bash
npm run db:migrate
```

So there are really two separate database entry points now:

- `knexfile.js` for migration commands
- the JSKIT server provider runtime for application code

That separation is good. It keeps the operational CLI workflow and the app runtime wiring clear.

### The MySQL package registers the driver, and the generic runtime builds the Knex client

On the server side, the two installed packages split responsibilities very deliberately.

The MySQL-specific package registers a driver token:

```js
class DatabaseRuntimeMysqlServiceProvider {
  static id = "runtime.database.driver.mysql";

  register(app) {
    app.singleton("runtime.database.driver.mysql", () => MYSQL_DATABASE_DRIVER_API);
  }
}
```

That does **not** create the database client yet. It only tells the app, "a MySQL driver is available, and here is its dialect metadata."

The generic runtime then uses that driver to create the real Knex wiring:

```js
class DatabaseRuntimeServiceProvider {
  static id = "runtime.database";

  register(app) {
    app.singleton("runtime.database", () => DATABASE_RUNTIME_SERVER_API);

    if (!app.has("runtime.database.driver")) {
      app.singleton("runtime.database.driver", (scope) => resolveSingleRegisteredDriver(scope));
    }

    if (!app.has("jskit.database.knex")) {
      app.singleton("jskit.database.knex", (scope) => createKnexInstance(scope));
    }

    if (!app.has("jskit.database.transactionManager")) {
      app.singleton("jskit.database.transactionManager", (scope) => {
        const knex = scope.make("jskit.database.knex");
        return createTransactionManager({ knex });
      });
    }
  }
}
```

That one provider is the real center of this chapter. It gives later server code a standard set of container tokens:

- `runtime.database`
- `runtime.database.driver`
- `jskit.database.knex`
- `jskit.database.transactionManager`

This is why later packages can simply say "I require `runtime.database`" instead of building their own database bootstrap.

### Why the browser still feels unchanged

At first glance it can feel strange that the database layer is installed but the app still behaves almost exactly like the previous chapter.

The reason is simple:

- the runtime is now available
- but almost no installed package is using it yet

Right now:

- `shell-web` is still a shell/layout package
- `auth-web` is still a web auth package
- `auth-provider-supabase-core` is still talking to Supabase for the real auth work

So the app has gained a new capability, but no visible part of the UI depends on that capability yet.

### Why auth still uses the standalone profile mirror

This is the most important code path to read in this chapter.

Inside `AuthSupabaseServiceProvider`, auth still resolves its profile mode from the environment:

```js
const authProfileMode = resolveAuthProfileMode(env);
let userProfileSyncService = fallbackStandaloneProfileSyncService;

if (authProfileMode === AUTH_PROFILE_MODE_USERS) {
  if (!scope.has("users.profile.sync.service")) {
    throw new Error(
      "AuthSupabaseServiceProvider requires users.profile.sync.service when AUTH_PROFILE_MODE=users."
    );
  }
  userProfileSyncService = scope.make("users.profile.sync.service");
}
```

That snippet explains the whole consequence of this chapter.

- The default mode is still `standalone`.
- The fallback service is still the in-memory profile sync service from the previous chapter.
- Nothing in `database-runtime-mysql` changes `AUTH_PROFILE_MODE`.
- Nothing in `database-runtime-mysql` provides `users.profile.sync.service`.

So the auth layer keeps behaving the same way it did before:

- Supabase still owns the real auth user and session
- JSKIT still mirrors just enough profile data locally
- that JSKIT-side mirror is still not persistent yet

The database runtime is now ready, but the users layer that will actually use it has not been installed yet.

### Why the empty `migrations/` directory is important

The new `migrations/` directory can look almost silly at first because it only contains `.gitkeep`. But that empty directory is the cleanest signal of what this chapter really does.

It means:

- the app now has a migration system
- the app does **not** yet have a schema of its own

That is exactly the right state at this stage of the guide.

The database runtime chapter should give the app a database foundation first. The next data-heavy chapters can then install actual schema migrations on top of that foundation.

## Summary

This chapter did not make the app feel dramatically different in the browser, but it changed the server foundation in an important way.

- the app now has a real JSKIT database runtime
- the app now has a standard Knex migration workflow
- the app now has a place for future schema files

But just as importantly, this chapter also defined what has **not** changed yet:

- auth still uses the standalone JSKIT-side mirror
- JSKIT still has no persistent users layer of its own
- no feature package has started storing real app data yet

So the right mental model at the end of this chapter is:

- Supabase already handles real authentication
- MySQL is now wired up and ready
- the persistent JSKIT-side user model arrives in the next chapter
