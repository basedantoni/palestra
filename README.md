# Fitness App

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines React, TanStack Router, Hono, TRPC, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **TanStack Router** - File-based routing with full type safety
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **shadcn/ui** - Reusable UI components
- **Hono** - Lightweight, performant server framework
- **tRPC** - End-to-end type-safe APIs
- **Node.js** - Runtime environment
- **Drizzle** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Authentication** - Better-Auth
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
pnpm install
```

## Environment Setup

The server validates its environment at startup, so a fresh clone needs a
`.env` before it will boot.

1. Copy the example file and fill in the required vars:

```bash
cp apps/server/.env.example apps/server/.env
```

2. Set the four **required** vars in `apps/server/.env`:
   - `DATABASE_URL` — Postgres connection string (the example default matches the local Docker DB below)
   - `BETTER_AUTH_SECRET` — 32+ char secret (`openssl rand -base64 32`)
   - `BETTER_AUTH_URL` — `http://localhost:3000`
   - `CORS_ORIGIN` — `http://localhost:3001`

   The Whoop integration vars (`WHOOP_*`, `TOKEN_ENCRYPTION_KEY`) are
   **optional** — leave them blank to run without Whoop sync. Every var and its
   constraint is documented inline in `apps/server/.env.example`.

## Database Setup

This project uses PostgreSQL with Drizzle ORM.

1. Start a local Postgres container (uses `packages/db/docker-compose.yml`):

```bash
pnpm db:start
```

2. Apply the schema to your database:

```bash
pnpm db:push
```

Then, run the development server:

```bash
pnpm run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
Use the Expo Go app to run the mobile application.
The API is running at [http://localhost:3000](http://localhost:3000).

## Project Structure

```
src/
├── apps/
│   ├── web/         # Frontend application (React + TanStack Router)
│   └── server/      # Backend API (Hono, TRPC)
├── packages/
│   ├── api/         # API layer / business logic
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
```

## Available Scripts

- `pnpm run dev`: Start all applications in development mode
- `pnpm run build`: Build all applications
- `pnpm run dev:web`: Start only the web application
- `pnpm run dev:server`: Start only the server
- `pnpm run check-types`: Check TypeScript types across all apps
- `pnpm run db:push`: Push schema changes to database
- `pnpm run db:studio`: Open database studio UI
