# Run a second stack

A stack of your own, beside the user's: its own ports, its own database in the same Postgres container, its own `.env` files. Use it when you work in a worktree or run beside other agents.

## 1. Pick ports and a database name

```sh
S=3100; W=3101; DB=palestra_<ticket>      # e.g. palestra_koi305
lsof -nP -iTCP:$S -iTCP:$W -sTCP:LISTEN   # empty output = free; else try 3200/3201, 3300/3301, ...
```

## 2. Create the database and env files

`.env` files are gitignored, so a fresh worktree has none. Postgres must be up (`pnpm db:start`).

```sh
docker exec palestra-postgres psql -U postgres -c "CREATE DATABASE $DB"
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
```

Then set these in the copies. CORS and Better-Auth trust only these URLs, so all four must agree:

| File | Variable | Value |
| --- | --- | --- |
| `apps/server/.env` | `DATABASE_URL` | `postgres://postgres:password@localhost:5433/$DB` |
| `apps/server/.env` | `BETTER_AUTH_URL` | `http://localhost:$S` |
| `apps/server/.env` | `CORS_ORIGIN` | `http://localhost:$W` |
| `apps/web/.env` | `VITE_SERVER_URL` | `http://localhost:$S` |

`db:migrate`, the seeds and the scripts read `apps/server/.env`, so they hit `$DB` from here on. Then run SKILL.md step 2 from `pnpm install` through `pnpm db:seed:finance`.

## 3. Start the servers

`pnpm dev:server` runs through turbo, which drops `PORT`. `pnpm --dir` runs each package's `dev` script directly:

```sh
mkdir -p logs
PORT=$S pnpm --dir apps/server dev > logs/server.log 2>&1                 # run_in_background
pnpm --dir apps/web dev --port $W --strictPort > logs/web.log 2>&1      # run_in_background
```

Log in as in SKILL.md step 3, with `$S` and `$W` in place of 3000 and 3001 (including the curl `Origin` header).

## 4. Clean up

Stop the two background commands you started; that ends each process tree. A pattern like `pkill -f "tsx watch"` would also match the user's server. If you lost the commands, stop each listener and its parent: killing only the listener leaves `tsx watch` running.

```sh
for p in $(lsof -t -iTCP:$S -iTCP:$W -sTCP:LISTEN); do kill "$p" "$(ps -o ppid= -p "$p")"; done
pgrep -fl "$PWD/apps/server"   # empty = nothing left
docker exec palestra-postgres psql -U postgres -c "DROP DATABASE $DB"
rm apps/server/.env apps/web/.env
```
