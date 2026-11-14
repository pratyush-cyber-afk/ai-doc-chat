import express from "express";
import { z } from "zod";
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { CHAT_SYSTEM_PROMPT } from "./prompts";
import rateLimit from "express-rate-limit";
import { tokenBudget, recordUsage, usageKey } from "./tokenBudget";
import { search, AccessLevelSchema, type SearchResult } from "./lib/search";
import { formatContext } from "./lib/context";
import path from "node:path";
import helmet from "helmet";

import { auth } from "./lib/auth";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";

import type { Request, Response, NextFunction } from "express";

const app = express();
// Render: client → Cloudflare → Render proxy → Render proxy → app (verified Nov 4 via X-Forwarded-For)
app.set("trust proxy", 3);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: { upgradeInsecureRequests: null },
    },
  }),
);

// Better Auth handles all /api/auth/* routes (sign-up, sign-in, session...)
app.all("/api/auth/{*any}", toNodeHandler(auth));

app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a minute and try again." },
});

app.use("/api", apiLimiter);
// Who is calling? Look it up once; later middleware and routes reuse it
app.use("/api", async (req, res, next) => {
  res.locals.session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  next();
});
app.use("/api", tokenBudget);

const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4000),
});

const ChatRequestSchema = z
  .object({
    messages: z.array(ChatMessageSchema).min(1).max(50),
  })
  .refine((data) => data.messages.at(-1)?.role === "user", {
    message: "The last message must be from the user.",
  });

app.post("/api/chat", async (req, res) => {
  const session = res.locals.session;
  if (!session) {
    return res.status(401).json({ error: "Please sign in to chat." });
  }

  const result = ChatRequestSchema.safeParse(req.body);
  if (!result.success) {
    console.error("Chat validation failed:", result.error.issues);
    return res.status(400).json({ error: "Invalid request" });
  }
  const { messages } = result.data;

  const accessLevel = AccessLevelSchema.parse(session.user.accessLevel);
  console.log(`Chat as ${session.user.id} (${accessLevel})`);

  const key = usageKey(req, res);

  const last = messages[messages.length - 1];

  let context: string;
  let results: SearchResult[] = [];
  try {
    results = await search(last.content, accessLevel);
    console.log(
      "Retrieved:",
      results.map((r) => `${r.id} (${r.distance.toFixed(3)})`),
    );
    context = formatContext(results);
  } catch (err) {
    console.error("Search failed:", err);
    return res.status(503).json({
      error: "Document search is unavailable right now. Please try again.",
    });
  }

  const augmented = [
    ...messages.slice(0, -1),
    {
      role: "user" as const,
      content: `${context}\n\nQuestion: ${last.content}`,
    },
  ];

  const ai = streamText({
    model: anthropic("claude-haiku-5-5"),
    system: CHAT_SYSTEM_PROMPT,
    maxOutputTokens: 1500,
    messages: augmented,
    onFinish: ({ usage }) => {
      console.log("Usage:", usage);
      recordUsage(key, (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0));
    },
    onError: ({ error }) => console.error("Stream error:", error),
  });
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");

  const send = (event: object) => res.write(JSON.stringify(event) + "\n");

  const sources = Object.values(
    results.reduce<
      Record<string, { doc_id: string; title: string; headings: string[] }>
    >((acc, r) => {
      acc[r.doc_id] ??= { doc_id: r.doc_id, title: r.title, headings: [] };
      acc[r.doc_id].headings.push(r.heading);
      return acc;
    }, {}),
  );
  send({ type: "sources", sources });

  try {
    for await (const part of ai.stream) {
      if (part.type === "text-delta") {
        send({ type: "text", text: part.text });
      } else if (part.type === "error") {
        send({
          type: "error",
          message: "The reply was interrupted. Please try again.",
        });
      } else if (part.type === "finish") {
        send({ type: "done", finishReason: part.finishReason });
      }
    }
  } catch (err) {
    console.error(err);
    send({
      type: "error",
      message: "The reply was interrupted. Please try again.",
    });
  } finally {
    res.end();
  }
});

const clientDist = path.join(process.cwd(), "client", "dist");
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});
app.use(express.static(clientDist));
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  console.error("Unhandled error", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = Number(process.env.PORT ?? 3000);

app.listen(PORT, (err) => {
  if (err) throw err;
  console.log(`Server on http://localhost:${PORT}`);
});
