# AI Doc Chat

A full-stack AI chat app built with React, Express, and the Claude API.
Replies stream in live, the conversation keeps its memory, and every request
and response is validated. It's growing into a secure, permission-aware document
assistant (RAG): documents are chunked, embedded and stored in Postgres with
pgvector, and search only returns chunks the user's access level allows.

**Live demo:** https://charon-nova.onrender.com (public access level only; the free instance sleeps
when idle, so the first load can take about a minute)

![Screenshot](docs/screenshot.png)

## Features

- Streaming chat with Claude: replies appear word by word, with full conversation memory
- Express backend that proxies requests, so the API key never reaches the browser
- Request validation with zod: roles, message count, length, last message from the user
- Structured output: a `/api/summarize` endpoint returns validated JSON (title, summary, tags, sentiment)
- Mid-stream error handling: interrupted replies roll back, and cut-off replies are flagged
- Safe error handling: generic messages to users, details only in server logs
- Failed messages roll back to the input box so the user can retry
- Rate limiting: each IP can make up to 20 API requests per minute (429 with a friendly message after that)
- Daily token budget: each IP can use up to 50,000 tokens per day across all AI endpoints (429 once it's used up)
- Assistant replies render as markdown (tables, lists, bold, code), with user messages kept as plain text
- Chat UI: auto-scrolls as replies stream in, plus a "New chat" button to start fresh
- Document ingestion: markdown docs with frontmatter are split into chunks by heading, with a size fallback and overlap
- Embeddings with Voyage AI (`voyage-4`, 1024 dimensions), stored in Postgres + pgvector with an HNSW index
- Permission-aware similarity search: top-3 chunks filtered by access level, with a distance threshold so unrelated questions return nothing
- RAG chat: "Nova" answers only from retrieved documents, and says so plainly when the documents don't cover a question
- Sources: each answer shows which documents (and sections) it was based on
- Hybrid search: Postgres full-text search plus vector search, merged with Reciprocal Rank Fusion (RRF)
- Golden eval set: 35 hand-written questions measure hit rate, MRR, off-topic handling and leaks for vector vs hybrid search

## Tech stack

- **Frontend:** React, TypeScript, Vite
- **Backend:** Node.js 22, Express, TypeScript (tsx), zod
- **AI:** Claude API (Claude Haiku 5.5, chosen for speed and low cost) via the Vercel AI SDK and the Anthropic SDK
- **Embeddings:** Voyage AI `voyage-4`
- **Database:** Postgres 18 + pgvector 0.8, running in Docker (OrbStack on macOS) locally, Neon in production
- **Hosting:** Render (one web service: Express serves both the API and the built React app)

## API

| Method | Route            | What it does                                               |
| ------ | ---------------- | ---------------------------------------------------------- |
| POST   | `/api/chat`      | Streams a reply as NDJSON events (`sources`, `text`, `error`, `done`) |
| POST   | `/api/summarize` | Returns a structured summary as validated JSON             |

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
```

### 3. Start the database and load the documents

```bash
docker compose up -d                                                    # Postgres + pgvector
docker compose exec -T db psql -U app -d ai_doc_chat < db/schema.sql    # create the table and indexes
npm run chunk                                                           # preview chunks (free, stores nothing)
npm run embed                                                           # embed all chunks and store them
npm run search -- "What frequency is the signal on?" survey             # try a search
```

`npm run embed` is safe to re-run: chunks are upserted by id, and chunks that no longer exist are deleted.

### 4. Run the app (two terminals)

```bash
# Terminal 1: backend (http://localhost:3000)
npm run dev

# Terminal 2: frontend (http://localhost:5173)
cd client && npm run dev
```

### 5. Production build (optional)

```bash
npm run build   # builds the React app into client/dist
npm run dev     # Express now also serves the built app on http://localhost:3000
```

## Deployment

- **Database:** Neon (free tier, pgvector supported). Run `db/schema.sql` against it, then
  `DATABASE_URL="<neon url>" npm run embed` to load the chunks
- **App:** Render web service. Build command `npm install && npm run build`, start command `npm start`
- **Environment variables (set in Render, not in a file):** `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`,
  `DATABASE_URL` (Neon, direct connection, `sslmode=verify-full`), `DEMO_ACCESS_LEVEL=public`

## Security notes

- The API key lives only in the server's `.env` file, which is excluded from Git
- The frontend talks only to `/api/*` routes on its own origin (Vite proxy), never to the Claude API directly
- The server accepts only `user` and `assistant` roles, which blocks injected `system` messages
- Model output is validated too: structured responses are checked with zod before use
- Stream events are JSON, so model text can't fake an error or "done" signal
- A global error handler returns generic messages, so stack traces and file paths never reach the client
- The `x-powered-by` header is disabled to avoid revealing the framework
- Assistant replies are rendered with react-markdown, which builds React elements instead of raw HTML, so HTML or script in model output is never executed
- Images in model output are blocked, so a manipulated reply can't leak data through an image URL
- Links open in a new tab with `rel="noopener noreferrer"`
- Token usage is logged on the server, not exposed to the browser
- Rate limiting runs before validation and before any Claude call, so blocked requests cost nothing
- Rate limits are per IP and in memory for now; they'll move to per-user limits once login is added
- Middleware order is rate limiter → token budget → route, so the cheapest checks run first and blocked requests never reach Claude
- Tokens are counted even when a summary fails validation, so failed requests can't be used to get free usage
- Missing token counts default to 0 instead of NaN, so the budget check can't silently switch itself off
- Token budgets are stored in memory, so they reset when the server restarts; production would use Redis or a database
- Postgres is bound to `127.0.0.1` only, and the Docker image tag is pinned
- Access control happens in SQL, before ranking: chunks above the user's level are never retrieved, so the model can't leak what it never sees
- The access level is validated with zod and fails closed; later it will come from the logged-in session, never from the request or the model
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
- The live demo runs at `public` level only, set on the server; the planted injection doc is `survey` level, so the public site can't even retrieve it
- `trust proxy` is set to exactly one hop, so the rate limiter sees real client IPs behind Render's proxy without trusting spoofed `X-Forwarded-For` headers
- The production database connection uses `sslmode=verify-full`, which checks the server's certificate instead of only encrypting
- Render's GitHub app has access to this one repository only (least privilege)
- Secrets live in Render's environment settings; `.env`, `client/dist` and `node_modules` are git-ignored

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

## Roadmap

- [x] Week 1: chat app with memory
- [x] Week 2: zod validation ✅, structured output ✅, streaming ✅, system prompt ✅, rate limiting ✅, token budget ✅, markdown rendering ✅,
- [x] Week 3: Postgres + pgvector in Docker ✅, 15 sample docs ✅, chunking ✅, embeddings ✅, permission-aware search ✅
- [x] Week 4: retrieval in `/api/chat` ✅, sources ✅, hybrid search ✅, golden eval set ✅, deployed on Render + Neon ✅
