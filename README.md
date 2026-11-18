# Astro-Backend — Vyotish-Astro backend API

Hono + TypeScript on **Cloudflare Workers**. Bun is the local dev runtime (DECISIONS.md D2);
Docker exists for dev parity only — production deploys go through `wrangler deploy`.

**All business logic and ALL database access live here** (DECISIONS.md D3): the frontend
never touches Supabase. No RPC/stored functions — every query and rule is in this repo.

## Run locally (Bun)

```bash
bun install
bun run dev          # watch mode → http://localhost:3000
```

With Worker-runtime parity (workerd, bindings from `.dev.vars`):

```bash
cp .dev.vars.example .dev.vars   # fill values
bun run dev:workers
```

## Test / lint / typecheck

```bash
bun test             # unit + contract tests
bun run lint         # Biome check
bun run typecheck    # tsc --noEmit
```

## Endpoints

| Method | Path       | Description |
|--------|------------|-------------|
| GET    | `/health`  | Health check (contract envelope `{ data }`) |
| GET    | `/api`     | API info |
| GET    | `/api/v1`  | Versioned surface root — contract & planned endpoints |

Domain routers (`/panchang`, `/kundli`, `/horoscope`, …) mount under `/api/v1` as epics
land — see the contract in the meta repo: `docs/plan/epics.md` (API & data contracts v1).

**Response envelope (contract v1):**

```jsonc
// success
{ "data": …, "meta"?: { "page": 1, "limit": 20, "total": 0 } }
// error
{ "error": { "code": "not_found", "message": "…" } }
```

## Configuration

- `.env.example` — values for `bun run dev` (copy to `.env`, never commit it)
- `.dev.vars.example` — same values for `wrangler dev`
- Production: `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` etc. Secrets never live in
  the repo, frontend, or client code (PRD §14).

## Deploy (production — after owner approval, D8)

```bash
bun run deploy      # wrangler deploy
```

## Docker (local parity only)

```bash
bun run docker:build   # oven/bun pinned, multi-stage, non-root
bun run docker:run     # http://localhost:3000
```

> Dockerfiles are not yet build-tested on this workstation (Docker unavailable) —
> tracked in the meta repo placeholder register (P19).
