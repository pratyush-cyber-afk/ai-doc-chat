# AI Doc Chat

A full-stack AI chat app built with React, Express, and the Claude API.
Replies stream in live, the conversation keeps its memory, and every request
and response is validated. It's growing into a secure, permission-aware document
assistant (RAG): documents are chunked, embedded and stored in Postgres with
pgvector, and search only returns chunks the user's access level allows.

**Live demo:** https://charon-nova.onrender.com (anyone can chat at the public level without signing in;
signing in with Google unlocks higher levels, though Google sign-in is limited to approved test accounts
for now. The free instance sleeps when idle, so the first load can take about a minute)

![Screenshot](docs/screenshot.png)

## Features

- Streaming chat with Claude: replies appear word by word, with full conversation memory
- Express backend that proxies requests, so the API key never reaches the browser
- Request validation with zod: roles, message count, length, last message from the user
- Mid-stream error handling: interrupted replies roll back, and cut-off replies are flagged
- Safe error handling: generic messages to users, details only in server logs
- Failed messages roll back to the input box so the user can retry
- Rate limiting: each IP can make up to 20 API requests per minute (429 with a friendly message after that)
- Daily token budget: each signed-in user can use up to 50,000 tokens per day of chat, falling back to per IP when logged out (429 once it's used up); usage is stored in Postgres, so it survives restarts and redeploys
- Assistant replies render as markdown (tables, lists, bold, code), with user messages kept as plain text
- Chat UI: auto-scrolls as replies stream in, plus a "New chat" button to start fresh
- Document ingestion: markdown docs with frontmatter are split into chunks by heading, with a size fallback and overlap
- Embeddings with Voyage AI (`voyage-4`, 1024 dimensions), stored in Postgres + pgvector with an HNSW index
- Permission-aware similarity search: top-3 chunks filtered by the signed-in user's access level, with a distance threshold so unrelated questions return nothing
- RAG chat: "Nova" answers only from retrieved documents, and says so plainly when the documents don't cover a question
- Sources: each answer shows which documents (and sections) it was based on
- Hybrid search: Postgres full-text search plus vector search, merged with Reciprocal Rank Fusion (RRF)
- Golden eval set: 35 hand-written questions measure hit rate, MRR, off-topic handling and leaks for vector vs hybrid search
- Login with Google (OpenID Connect) and email/password (API only for now) via Better Auth; sessions stored in Postgres
- Per-user access levels: each user has a role (`user`/`admin`) and an access level stored server-side; it's read from the session on every request, so a level change applies on the next message without logging in again
- Logged-out visitors get public access; the UI shows who is signed in, and signing out also clears the conversation

## Tech stack

- **Frontend:** React, TypeScript, Vite
- **Backend:** Node.js 22, Express, TypeScript (tsx), zod
- **AI:** Claude API (Claude Haiku 5.5, chosen for speed and low cost) via the Vercel AI SDK
- **Embeddings:** Voyage AI `voyage-4`
- **Database:** Postgres 18 + pgvector 0.8, running in Docker (OrbStack on macOS) locally, Neon in production
- **Auth:** Better Auth (Google OIDC + email/password, Postgres sessions)
- **Hosting:** Render (one web service: Express serves both the API and the built React app)

## API

| Method | Route            | What it does                                               |
| ------ | ---------------- | ---------------------------------------------------------- |
| POST   | `/api/chat`      | Streams a reply as NDJSON events (`sources`, `text`, `error`, `done`) |
| GET/POST | `/api/auth/*`  | Better Auth routes (sign-in, callback, session, sign-out)  |

## Sample documents: Charon Colonial

`data/docs/` holds 15 fictional documents about a corporation, a survey ship and a mysterious signal.
Each one has an access level in its frontmatter, and the same events are told differently at each level.

| Level         | Who sees it                   | Docs |
| ------------- | ----------------------------- | ---- |
| `public`      | Colonists, investors          | 01, 02 |
| `personnel`   | All contract employees        | 03, 04, 05 |
| `survey`      | Science and mission crews     | 06–11, 15 |
| `directorate` | The board only                | 12, 13, 14 |

Levels stack: each level can read its own documents plus every level below it.
They double as test fixtures:

- **Leak test:** directorate-only facts (the buyer's name, the valuation) must never be returned to lower levels
- **Prompt injection test:** Doc 15 contains a planted indirect prompt injection on purpose
- **Hallucination test:** the story stops before the landing, so "what happened on the moon?" has no answer in the docs

## How a question is answered

1. **Retrieve:** the question is embedded and searched two ways, by meaning (pgvector) and by keywords
   (Postgres full-text search). Both searches filter by access level first. The two ranked lists are
   merged with RRF and the top 3 chunks are kept.
2. **Augment:** the chunks are wrapped in a `<documents>` block and added to the user's turn.
   A `sources` event (document titles and headings only) is sent to the browser.
3. **Generate:** Claude streams the answer, which the server forwards as `text` events.

## Evaluation

`npm run eval` runs the golden set in `eval/golden.json` (35 questions across all four access levels)
against both search modes and exits with an error if any restricted document leaks.

| Mode   | Hit rate @3 | MRR   | Off-topic returns nothing | Leaks |
| ------ | ----------- | ----- | ------------------------- | ----- |
| Vector | 28/30       | 0.933 | 2/2                       | 0     |
| Hybrid | 29/30       | 0.928 | 2/2                       | 0     |

Hybrid is the default. Its first run let an off-topic question through (the word "world" matched),
so the keyword branch also got a distance cutoff. One known miss in both modes: "Is the Asphodel
colony safe?" at survey level, a meaning gap that a reranker or query rewriting should fix.

## Getting started

### 1. Install dependencies

```bash
npm install
cd client && npm install
```

### 2. Add your keys

Create a `.env` file in the project root (see `.env.example`):

```
ANTHROPIC_API_KEY=your-key-here
VOYAGE_API_KEY=your-key-here
POSTGRES_PASSWORD=choose-a-password
DATABASE_URL=postgres://app:choose-a-password@127.0.0.1:5432/ai_doc_chat
BETTER_AUTH_SECRET=generate-with-openssl-rand-base64-32
BETTER_AUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

Google sign-in needs an OAuth client in Google Cloud with the exact redirect URI
`http://localhost:3000/api/auth/callback/google`.

### 3. Start the database and load the documents

```bash
docker compose up -d                                                    # Postgres + pgvector
docker compose exec -T db psql -U app -d ai_doc_chat < db/schema.sql    # create the table and indexes
npm run chunk                                                           # preview chunks (free, stores nothing)
npm run embed                                                           # embed all chunks and store them
npm run search -- "What frequency is the signal on?" survey             # try a search
```

`npm run embed` is safe to re-run: chunks are upserted by id, and chunks that no longer exist are deleted.

### 4. Create the auth tables

```bash
npx auth migrate --config lib/auth.ts
```

### 5. Run the app (two terminals)

```bash
# Terminal 1: backend (http://localhost:3000)
npm run dev

# Terminal 2: frontend (http://localhost:5173)
cd client && npm run dev
```

### 6. Production build (optional)

```bash
npm run build   # builds the React app into client/dist
npm run dev     # Express now also serves the built app on http://localhost:3000
```

### Change a user's access level

```bash
docker compose exec db psql -U app -d ai_doc_chat -c "update \"user\" set \"accessLevel\" = 'survey' where email = 'user@example.com';"
```

## Deployment

- **Database:** Neon (free tier, pgvector supported). Run `db/schema.sql` against it, then
  `DATABASE_URL="<neon url>" npm run embed` to load the chunks
- **App:** Render web service. Build command `npm install && npm run build`, start command `npm start`
- **Environment variables (set in Render, not in a file):** `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`,
  `DATABASE_URL` (Neon, direct connection, `sslmode=verify-full`), `BETTER_AUTH_SECRET` (a separate value
  from local), `BETTER_AUTH_URL` (the Render URL), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- **Auth tables:** run the auth migration against Neon separately (local and prod are different databases),
  and migrate before deploying code that needs the tables
- **Google:** add the Render callback URL (`<render url>/api/auth/callback/google`) to the Google OAuth client

## Security notes

- The API key lives only in the server's `.env` file, which is excluded from Git
- The frontend talks only to `/api/*` routes on its own origin (Vite proxy), never to the Claude API directly
- The server accepts only `user` and `assistant` roles, which blocks injected `system` messages
- Stream events are JSON, so model text can't fake an error or "done" signal
- A global error handler returns generic messages, so stack traces and file paths never reach the client
- helmet sets security headers (CSP, HSTS, nosniff, frame-ancestors) and removes `x-powered-by`
- Assistant replies are rendered with react-markdown, which builds React elements instead of raw HTML, so HTML or script in model output is never executed
- Images in model output are blocked, so a manipulated reply can't leak data through an image URL
- Links in model output render as plain text (the href is dropped), like images, so a manipulated reply can't plant a clickable link
- Token usage is logged on the server, not exposed to the browser
- Rate limiting runs before validation and before any Claude call, so blocked requests cost nothing
- The per-minute rate limit stays per IP on purpose (it runs before we know who you are); the daily token budget is per user
- Middleware order is rate limiter (IP, no DB) → session lookup → token budget → route, so the cheapest check runs first
- Missing token counts default to 0 instead of NaN, so the budget check can't silently switch itself off
- Token usage is stored in a Postgres `usage` table (one row per key per day), so the daily budget survives restarts and redeploys
- Usage is added with an atomic upsert (`ON CONFLICT ... DO UPDATE SET tokens = usage.tokens + EXCLUDED.tokens`), so concurrent requests can't lose updates
- The budget check fails open if the database read errors (it's a cost control, not auth; the rate limit still caps volume)
- Postgres is bound to `127.0.0.1` only, and the Docker image tag is pinned
- Access control happens in SQL, before ranking: chunks above the user's level are never retrieved, so the model can't leak what it never sees
- The access level comes from the server-side session, never from the request or the model, and is validated with zod (fails closed)
- A distance threshold stops search from always returning something, so unrelated questions don't pull in random context
- All SQL uses placeholders (`$1`, `$2`…), so document text and questions are treated as data, never as SQL
- Re-ingesting deletes chunks that no longer exist, so an old copy of a restricted document can't linger in search
- gray-matter's JavaScript frontmatter engine is disabled, since it would run code from a document through `eval`
- Frontmatter is validated with zod, so a document with a typo in its access level is rejected instead of being misfiled
- A database CHECK constraint on `access_level` backs up the zod check (defense in depth)
- Hybrid search applies the same access filter in both the vector and the keyword branch; missing it in either would leak
- Retrieved documents go in the user turn inside a `<documents>` block, fake closing tags are stripped, and the system prompt says document text is never instructions
- The `sources` event sends only titles and headings, never chunk content or distances
- The eval script checks every question for leaks and fails the run if one appears
- Logged-out visitors get `public` level; the planted injection doc is `survey` level, so anonymous visitors can't retrieve it
- `trust proxy` is set to the exact number of proxy hops on Render (3: Cloudflare + 2 Render proxies), verified via `X-Forwarded-For`
- The production database connection uses `sslmode=verify-full`, which checks the server's certificate instead of only encrypting
- Render's GitHub app has access to this one repository only (least privilege)
- Secrets live in Render's environment settings; `.env`, `client/dist` and `node_modules` are git-ignored
- Unknown `/api` routes return a JSON 404 instead of the app's HTML; 400 errors are generic ("Invalid request")
- Sessions instead of JWTs, so a session can be revoked instantly; cookies are HttpOnly, Secure (with the `__Secure-` prefix) and SameSite=Lax
- `role` and `accessLevel` can't be set by the client (Better Auth `input: false`), which blocks mass assignment at sign-up
- Google redirect URIs are registered exactly; the post-login callback must be a trusted origin (no open redirects)
- The signed-in user's name is rendered as React text, never as HTML or markdown
- Unused endpoints and packages were removed to reduce attack surface
- Separate auth secrets for local and production

### Attack-tested (Week 8)

I attacked my own deployment with six attacks mapped to MITRE ATLAS and the OWASP LLM Top 10 (2026):

| Attack | Result | What held |
| --- | --- | --- |
| Poisoned document (fake "correction notice", T0066/T0070) | 🟡 partial | The prompt rule blocked the injected *instruction*, but forged *facts* were reported when the poisoned chunk won retrieval. The real control is that only the owner can write to the corpus |
| Fake `</documents>` tags (T0071) | ✅ blocked | Fence tags are stripped in code before the documents are wrapped |
| Restricted doc as a logged-out user, incl. a forged `accessLevel` in the body | ✅ blocked | SQL access filter before retrieval; level read from the session; zod strips unknown fields |
| System prompt extraction (T0056) | ✅ low impact | Naive payloads were refused, but the prompt is treated as public and holds no secrets |
| Exfil image / link / fake citation (T0077) | ✅ blocked | Images and links render inert; Sources come from retrieval, not model text |
| Token burn (T0034, LLM06) | ✅ (gap fixed) | 20 req/min limit, 4000-char cap before the model call, and a daily token budget now stored in Postgres |

Known open gap: logged-out limits are per IP, so rotating IPs gets a fresh allowance. Fixing that needs auth-gating or a WAF rather than app code.

## What I learned

- The Claude Messages API is stateless: the full history is sent on every turn,
  so input tokens grow with each message (23 → 187 → 438 in my test)
- Never trust input or output: validate requests with zod, and validate the model's JSON too
- Once a stream starts, the HTTP status is already 200, so errors must be sent as events in the stream
- Testing edge cases found a real bug: an empty message array crashed validation and leaked a stack trace
- React state updates are not immediate, so I build the new array before sending it,
  and use functional updates inside the streaming loop
- Fast-moving libraries change often: the editor's type hints flagged deprecated APIs that tutorials still use
- The model refused to quote its system prompt but paraphrased it anyway, so system prompts must be treated as public.
- Rate limits count requests, but cost depends on tokens, so both limits are needed and they cover each other's gaps
- Security controls should fail closed: a `NaN` in the token count would have disabled the budget check without any error
- Test values (like a limit of 3) are easy to commit by accident, so I check `git diff` before every commit
- The model's caution isn't a security control: asked to output an XSS payload, it refused, then printed it anyway in a code block. The renderer is what kept it safe.
- `useRef` holds a DOM element (a marker at the bottom of the chat) so `useEffect` can scroll to it after each streamed chunk
- Clearing the chat mid-stream would crash the streaming loop (a race condition), so "New chat" is disabled while a reply is streaming
- An embedding turns text into 1024 numbers; similar meanings point in similar directions, measured with cosine distance (`<=>`)
- Questions and documents are embedded with different `input_type` values, so a question lands near its answer
- Measuring beats guessing: good answers landed at 0.56–0.60 and junk at 0.80+, so I set the threshold at 0.7
- Similarity ignores permissions: a nearest-neighbour check pulled a directorate memo next to a survey log, which is why filtering must happen before ranking
- Ingest scripts must be idempotent (a unique key plus upsert), or every re-run duplicates data
- Free API tiers have rate limits: one 14K-token request failed with a 429 until a payment method raised the limit
- RAG is Retrieve, Augment, Generate: the AI SDK only talks to Claude; the database work and the NDJSON events are my own server code
- Similarity isn't truth: "Is the colony safe?" matched upbeat press copy instead of the incident reports
- Keyword search catches exact names (like "Ferryman") that vectors can miss, but it isn't automatically better: it needed its own cutoff
- Postgres full-text search has crude stemming and no IDF, which is why BM25 and rerankers exist
- A golden eval set turns "it feels better" into numbers, and running old vs new side by side shows whether a change helped
- A hung chat turned out to be a server suspended with Ctrl+Z still holding port 3000, while the new server ignored its listen error
- A leaked database password must be rotated, not just deleted from the screen, and `read -s` keeps secrets out of shell history
- Deploying changes the network: behind a proxy, every request seems to come from the proxy unless `trust proxy` is set
- Sessions vs JWT: a session is a ticket the server can revoke instantly; a JWT is a signed card that can't be revoked and goes stale
- OAuth is a valet key; OpenID Connect adds the ID token that says who you are. The code goes in the URL, the token is swapped server to server
- 401 means "I don't know who you are", 403 means "I know you and you're not allowed"
- Hiding a button or a field is UX, not access control: the client can send anything, so the server decides
- Local and production databases drift unless both are migrated; migrate before deploying code that needs the new tables
- Middleware order matters: reject cheaply (IP limit) before expensive work (database lookups)
- Clearing the screen on sign-out matters on shared computers
- A prompt rule is a request; code is enforcement. In my own attacks, every defence that fully held was code
- An injection has two halves: the instruction and the false fact. "Never follow document instructions" stops the first, not the second, and a forged fact only bites when it wins retrieval
- Code defines the `<documents>` boundary; the prompt only polices what's inside it
- A read-then-write in JS loses updates under concurrency; doing the add inside one SQL upsert fixes it
- Deploying doesn't run migrations, and the old instance keeps serving until the new deploy is live, so test only after that

## Roadmap

- [x] Week 1: chat app with memory
- [x] Week 2: zod validation ✅, structured output ✅, streaming ✅, system prompt ✅, rate limiting ✅, token budget ✅, markdown rendering ✅
- [x] Week 3: Postgres + pgvector in Docker ✅, 15 sample docs ✅, chunking ✅, embeddings ✅, permission-aware search ✅
- [x] Week 4: retrieval in `/api/chat` ✅, sources ✅, hybrid search ✅, golden eval set ✅, deployed on Render + Neon ✅
- [x] Week 5: HTTP/TLS/DNS basics ✅, PortSwigger XSS + SQLi labs ✅, security review of the app (helmet, JSON 404, generic errors, prompt leak, link rendering) ✅
- [x] Week 6: sessions vs JWT ✅, OAuth/OIDC ✅, PortSwigger access control + auth labs ✅, Better Auth with Google login ✅, per-user access levels and token budget ✅
- [x] Week 7: OWASP LLM + Agentic Top 10 (2026) ✅, MITRE ATLAS ✅, prompt injection practice (Lakera Agent Breaker, PortSwigger Web LLM labs) ✅
- [x] Week 8: attacked my own app (6 attacks) ✅, durable per-account token budget in Postgres ✅
