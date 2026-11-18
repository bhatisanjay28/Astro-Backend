# Astro-Backend — Vyotish-Astro backend API (starter scaffold)

Minimal Node.js + Express API. Extend with real endpoints as the backend takes shape.

## Run locally

```bash
npm install
npm run dev        # watch mode, http://localhost:3000
```

## Endpoints

| Method | Path      | Description                          |
|--------|-----------|--------------------------------------|
| GET    | `/health` | Health check (JSON status)           |
| GET    | `/api`    | API info                             |

## Docker

```bash
docker build -t astro-backend .
docker run -p 3000:3000 astro-backend
```

## Notes

- Port comes from the `PORT` env var (defaults to 3000).
- This scaffold is intentionally minimal — swap in your own stack/layout as needed.
