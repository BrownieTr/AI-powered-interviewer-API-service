# AI Phone Interviewer (COMP4537 Milestone 2)

Monorepo for an **AI-powered RESTful API** in the **AI Phone Agent / Virtual Front Desk** category, adapted to run **resume- and job-description-driven phone-style interviews**. The browser client acts as the candidate handset (text); the API initiates a session, drives the interviewer agent with the **Hugging Face Inference API** (chat completions), stores **full conversation context** in PostgreSQL, and returns **transcripts plus a structured outcome** when the call ends.

## Layout

- **`server/`** — Express + TypeScript: JWT auth, user management, secured routes, `/api/phone/*` interview API.
- **`client/`** — React + TypeScript (Vite): register/login, start sessions, live transcript, end-call summary.

## Prerequisites

- Node.js 20+
- npm
- A free [Hugging Face](https://huggingface.co/) account and an [access token](https://huggingface.co/settings/tokens) (`HF_TOKEN`)

## Configuration

**Server** — set these environment variables:

- `JWT_SECRET` — minimum **32 characters** (use a long random string in production).
- `HF_TOKEN` — Hugging Face token (read access is enough for inference).
- `HF_MODEL` — a Hub model id that supports chat completions via [Inference Providers](https://huggingface.co/docs/inference-providers/index) (default in `.env.example` is a small instruct model; change it if your account or quotas require another model).
- `DATABASE_URL` (or `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD`) for PostgreSQL.
- `CLIENT_ORIGIN` to the frontend URL.
- Optional: `HF_PROVIDER` to pin a provider (omit or `auto` for HF router defaults), plus `PORT`.
- Optional quota/admin settings:
  - `FREE_CALLS_LIMIT_DEFAULT` (default `25`) for new users.
  - `ADMIN_SEED_EMAIL` + `ADMIN_SEED_PASSWORD` to auto-provision an admin account at startup.

Inference free tiers and quotas change over time; check [HF pricing / limits](https://huggingface.co/pricing) for current rules. Gated models (e.g. Llama) require accepting the license on the model page first.

**Client** — optional `client/.env` from `client/.env.example`:

- `VITE_API_URL` — API base URL (default `http://localhost:3001`).

## Development

**Terminal 1 — API**

```bash
cd server
cp .env.example .env
# Edit .env: JWT_SECRET + HF_TOKEN (and HF_MODEL if needed)
npm run dev
```

**Terminal 2 — client**

```bash
cd client
npm run dev
```

- Client: http://localhost:5173
- API: http://localhost:3001
- Health: `GET http://localhost:3001/health` (no auth)

## Security features (API)

- **Helmet** security headers; **CORS** restricted to `CLIENT_ORIGIN`.
- **Rate limiting** on `/api/*` and stricter limits on `/api/auth/*`.
- **Password hashing** (bcrypt), **JWT** bearer auth for protected routes.
- **Input validation** (Zod), JSON body size limit, **no stack traces** in production error responses.
- **PostgreSQL** with scoped interview/session records per user.
- **Role-based access** (`user` / `admin`) and quota tracking for billable AI turns.

## API overview (authenticated)

| Method  | Path                               | Purpose                                                                    |
| ------- | ---------------------------------- | -------------------------------------------------------------------------- |
| `POST`  | `/api/auth/register`               | Create account → JWT                                                       |
| `POST`  | `/api/auth/login`                  | Sign in → JWT                                                              |
| `GET`   | `/api/users/me`                    | Current user profile                                                       |
| `PATCH` | `/api/users/me/password`           | Change password                                                            |
| `GET`   | `/api/phone/sessions`              | List interview sessions                                                    |
| `POST`  | `/api/phone/sessions`              | **Start call** — body: `resume`, `jobDescription` → first interviewer line |
| `GET`   | `/api/phone/sessions/:id`          | Transcript + status + outcome                                              |
| `POST`  | `/api/phone/sessions/:id/messages` | Candidate reply → next interviewer turn                                    |
| `POST`  | `/api/phone/sessions/:id/complete` | End call → structured **outcome** + transcript                             |
| `GET`   | `/api/admin/usage/summary`         | Admin-only aggregate usage metrics                                         |
| `GET`   | `/api/admin/usage/users`           | Admin-only per-user quota/usage report                                     |

Send `Authorization: Bearer <token>` on all routes except `/api/auth/*` and `/health`.

Quota behavior:

- AI usage is metered on start/turn/complete operations.
- Standard users are blocked with `402` when free quota is exhausted.
- Admin users are not blocked by quota.

## Production build

```bash
cd server && npm run build && npm start
cd client && npm run build && npm run preview
```

Set `CLIENT_ORIGIN` to your deployed SPA origin and `VITE_API_URL` to the public API URL when building the client.

## Real telephony (optional extension)

The milestone flow is fully exercised over HTTP with a text UI. To attach **real phone numbers**, you would add **Twilio** (or similar) webhooks that transcribe speech → `POST .../messages` and text-to-speech for assistant replies, reusing the same session and transcript model.
