# AI Doc Chat

A full-stack AI chat app built with React, Express, and the Claude API.
It keeps conversation memory and handles errors safely. This is week 1 of a
larger project that will grow into a secure, permission-aware document
assistant (RAG).

![Screenshot](docs/screenshot.png)

## Features

- Chat with Claude, with full conversation memory
- Express backend that proxies requests, so the API key never reaches the browser
- Input validation on every request: roles, message count, length
- Safe error handling: generic messages to users, details only in server logs
- Failed messages roll back to the input box so the user can retry

## Tech stack

- **Frontend:** React, TypeScript, Vite
- **Backend:** Node.js 22, Express, TypeScript (tsx)
- **AI:** Anthropic Claude API (Claude Haiku 5.5, chosen for speed and low cost.”)

## Getting started

### 1. Install dependencies

```bash
npm install
cd client && npm install
```

### 2. Add your API key

Create a `.env` file in the project root (see `.env.example`):

```
ANTHROPIC_API_KEY=your-key-here
```

### 3. Run the app (two terminals)

```bash
# Terminal 1: backend (http://localhost:3000)
npm run dev

# Terminal 2: frontend (http://localhost:5173)
cd client && npm run dev
```

## Security notes

- The API key lives only in the server's `.env` file, which is excluded from Git
- The frontend talks only to `/chat` on its own origin (Vite proxy), never to the Claude API directly
- The server accepts only `user` and `assistant` roles, which blocks injected `system` messages
- AI output is rendered as plain text (no `dangerouslySetInnerHTML`) to avoid XSS
- Token usage is logged on the server, not exposed to the browser

## What I learned

- The Claude Messages API is stateless: the full history is sent on every turn,
  so input tokens grow with each message (23 → 187 → 438 in my test)
- Handling unexpected API responses, such as an empty reply when `max_tokens` is hit
- React state updates are not immediate, so I build the new array before sending it

## Roadmap

- [x] Week 1: chat app with memory
- [ ] Week 2: streaming, zod validation, rate limiting, markdown rendering
- [ ] Weeks 3–4: document upload and RAG with pgvector