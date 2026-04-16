# INITIAL SCAFFOLDING -- DONE

npx @jskit-ai/create-app exampleapp --tenancy-mode none
npm install

(show basic app)
(Show how to set completion in bash)

# A MORE INTERESTING SHELL

npx jskit add package shell-web
npm run db:migrate
npm install

(show placements)

- Improve look, maybe put a settings menu on the left in jskit
- Read after src/placement.js becomes the placement registry
- Explain that shell-web OVERWRITES things, and only if they are actually unchanged

# AUTHENTICATION

npx jskit add package auth-provider-supabase-core
npx jskit add package auth-web
npx jskit add package users-web
npm install

(Explain that authentication will work without a DB but explaining limitations)

# DATABASE LAYER

npx jskit add package database-runtime-mysql
npm install

(Show what is added, and explain the consequences to authentication)

# CONSOLE

# GENERATORS

(Show cruds, all best practices, etc.)

# MULTI HOMING

npx jskit add package workspaces-core
npx jskit add package workspaces-web
npm install
npm run db:migrate

(Show multi homing)

(Show multi homing crud, explain porting over)

# MORE GENERATORS

(Show cruds and multihoming config)

# REALTIME

npx jskit add package realtime
npm install
npm run db:migrate

# ASSISTANT







* Prep
- Make a supabase project (short instructions)
- Make a mysql database, call it exampleapp note login/password
- Make a Deepseek account (or, any one of the supported ones, check the source)
- You are ready for your first app!


* Quick start

npx @jskit-ai/create-app exampleapp --tenancy-mode personal
npm install
npx jskit add package shell-web
npx jskit add package database-runtime-mysql

npx jskit add package auth-provider-supabase-core
npx jskit add package auth-web
npx jskit add package database-runtime-mysql
npx jskit add package users-web
npx jskit add package workspaces-core
npx jskit add package workspaces-web
npx jskit add package realtime

npm install
npm run db:migrate
