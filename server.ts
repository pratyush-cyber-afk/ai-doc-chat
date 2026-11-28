import express from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  streamText,
  stepCountIs,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { CHAT_SYSTEM_PROMPT } from "./prompts";
import rateLimit from "express-rate-limit";
import { tokenBudget, recordUsage, usageKey } from "./tokenBudget";
import {
  AccessLevelSchema,
  type AccessLevel,
  type SearchResult,
} from "./lib/search";
import { makeSearchDocsTool, makeCreateTicketTool } from "./lib/tools";
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

// Tool calls paused for a human decision. In memory: resets on restart (fine for a demo).
type PendingApproval = {
  ownerKey: string;
  messages: ModelMessage[];
  approvals: { approvalId: string; toolName: string; input: unknown }[];
  createdAt: number;
};
const pendingApprovals = new Map<string, PendingApproval>();
const APPROVAL_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Runs the agent loop and streams NDJSON events to the browser.
// Used by both /api/chat (new question) and /api/chat/approve (resume).
const streamAgent = async (
  res: Response,
  messages: ModelMessage[],
  key: string,
  accessLevel: AccessLevel,
) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  const send = (event: object) => res.write(JSON.stringify(event) + "\n");

  const retrieved: SearchResult[] = [];
  const searchDocs = makeSearchDocsTool(accessLevel, (results) => {
    console.log(
      "Retrieved:",
      results.map((r) => `${r.id} (${r.distance.toFixed(3)})`),
    );
    retrieved.push(...results);
  });
  // Write tool only for signed-in users: logged-out visitors never even see it
  const signedIn = key.startsWith("user:");
  const tools: ToolSet = { search_docs: searchDocs };
  if (signedIn) tools.create_ticket = makeCreateTicketTool(key);

  const ai = streamText({
    model: anthropic("claude-haiku-5-5"),
    system: CHAT_SYSTEM_PROMPT,
    maxOutputTokens: 1500,
    messages,
    tools,
    stopWhen: stepCountIs(3),
    onFinish: ({ usage }) => {
      console.log("Usage:", usage);
      recordUsage(
        key,
        (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
      ).catch((err) => console.error("recordUsage failed:", err));
    },
    onError: ({ error }) => console.error("Stream error:", error),
  });

  const buildSources = () =>
    Object.values(
      retrieved.reduce<
        Record<string, { doc_id: string; title: string; headings: string[] }>
      >((acc, r) => {
        acc[r.doc_id] ??= { doc_id: r.doc_id, title: r.title, headings: [] };
        if (!acc[r.doc_id].headings.includes(r.heading)) {
          acc[r.doc_id].headings.push(r.heading);
        }
        return acc;
      }, {}),
    );

  const approvals: PendingApproval["approvals"] = [];
  let finishReason: string | undefined;

  try {
    for await (const part of ai.stream) {
      if (part.type === "text-delta") {
        send({ type: "text", text: part.text });
      } else if (part.type === "tool-approval-request") {
        approvals.push({
          approvalId: part.approvalId,
          toolName: part.toolCall.toolName,
          input: part.toolCall.input,
        });
      } else if (part.type === "error") {
        send({
          type: "error",
          message: "The reply was interrupted. Please try again.",
        });
      } else if (part.type === "finish") {
        finishReason = part.finishReason;
      }
    }

    if (approvals.length > 0) {
      // Forget expired requests so the Map can't grow forever
      for (const [id, p] of pendingApprovals) {
        if (Date.now() - p.createdAt > APPROVAL_TTL_MS) pendingApprovals.delete(id);
      }
      const pendingId = randomUUID();
      pendingApprovals.set(pendingId, {
        ownerKey: key,
        messages: [...messages, ...(await ai.responseMessages)],
        approvals,
        createdAt: Date.now(),
      });
      // The human sees the first request; any others from the same step get denied
      const { toolName, input } = approvals[0];
      console.log(`Approval needed (${pendingId}): ${toolName}`, input);
      send({ type: "approval", pendingId, toolName, input });
    }

    send({ type: "sources", sources: buildSources() });
    send({ type: "done", finishReason });
  } catch (err) {
    console.error(err);
    send({
      type: "error",
      message: "The reply was interrupted. Please try again.",
    });
  } finally {
    res.end();
  }
};

app.post("/api/chat", async (req, res) => {
  const session = res.locals.session;

  const result = ChatRequestSchema.safeParse(req.body);
  if (!result.success) {
    console.error("Chat validation failed:", result.error.issues);
    return res.status(400).json({ error: "Invalid request" });
  }
  const { messages } = result.data;

  const accessLevel = AccessLevelSchema.parse(
    session?.user.accessLevel ?? "public",
  );
  console.log(`Chat as ${session?.user.id ?? "anonymous"} (${accessLevel})`);

  await streamAgent(res, messages, usageKey(req, res), accessLevel);
});

const ApprovalRequestSchema = z.object({
  pendingId: z.uuid(),
  approved: z.boolean(),
});

app.post("/api/chat/approve", async (req, res) => {
  const parsed = ApprovalRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }
  const { pendingId, approved } = parsed.data;
  const key = usageKey(req, res);
  const pending = pendingApprovals.get(pendingId);

  // One answer for "doesn't exist", "not yours" and "expired": don't reveal which
  if (
    !pending ||
    pending.ownerKey !== key ||
    Date.now() - pending.createdAt > APPROVAL_TTL_MS
  ) {
    return res
      .status(404)
      .json({ error: "This approval is no longer available." });
  }
  pendingApprovals.delete(pendingId); // single use: can't be replayed

  const accessLevel = AccessLevelSchema.parse(
    res.locals.session?.user.accessLevel ?? "public",
  );
  console.log(
    `Approval ${approved ? "GRANTED" : "DENIED"} by ${key}: ${pending.approvals[0].toolName}`,
  );

  const decision: ModelMessage = {
    role: "tool",
    content: pending.approvals.map((a, i) => ({
      type: "tool-approval-response" as const,
      approvalId: a.approvalId,
      approved: i === 0 ? approved : false,
    })),
  };

  await streamAgent(res, [...pending.messages, decision], key, accessLevel);
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
