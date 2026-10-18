import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { CHAT_SYSTEM_PROMPT } from "./prompts";
import rateLimit from "express-rate-limit";

import type { Request, Response, NextFunction } from "express";

const app = express();
app.disable("x-powered-by");

const client = new Anthropic();

app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 3,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a minute and try again." },
});

app.use("/api", apiLimiter);

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

const SummarizeRequestSchema = z.object({
  text: z.string().trim().min(1).max(10000),
});

const SummarySchema = z.object({
  title: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
  sentiment: z.enum(["positive", "neutral", "negative"]),
});

const summaryJsonSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
  },
  required: ["title", "summary", "tags", "sentiment"],
  additionalProperties: false,
};

app.post("/api/summarize", async (req, res) => {
  const parsed = SummarizeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
  }
  const { text } = parsed.data;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-5-5",
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: `Summarize the text inside the <text> tags. Use 3-5 short tags.\n\n<text>\n${text}\n</text>`,
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: summaryJsonSchema },
      },
    });

    console.log("Usage:", response.usage);

    if (response.stop_reason !== "end_turn") {
      return res.status(502).json({
        error: `Could not summarize (stop reason: ${response.stop_reason}).`,
      });
    }

    const textBlock = response.content.find((b) => b.type === "text");
    if (textBlock?.type !== "text") {
      return res.status(502).json({ error: "No summary returned." });
    }

    let data: unknown;
    try {
      data = JSON.parse(textBlock.text);
    } catch {
      return res.status(502).json({ error: "Claude returned invalid JSON." });
    }

    const summary = SummarySchema.safeParse(data);
    if (!summary.success) {
      console.error("Schema mismatch:", summary.error.issues);
      return res
        .status(502)
        .json({ error: "Summary didn't match the expected format." });
    }

    res.json(summary.data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong talking to Claude." });
  }
});

app.post("/api/chat", async (req, res) => {
  const result = ChatRequestSchema.safeParse(req.body);
  if (!result.success) {
    return res
      .status(400)
      .json({ error: result.error.issues[0]?.message ?? "Invalid request" });
  }
  const { messages } = result.data;

  const ai = streamText({
    model: anthropic("claude-haiku-5-5"),
    system: CHAT_SYSTEM_PROMPT,
    maxOutputTokens: 1500,
    messages,
    onFinish: ({ usage }) => console.log("Usage:", usage),
    onError: ({ error }) => console.error("Stream error:", error),
  });
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");

  const send = (event: object) => res.write(JSON.stringify(event) + "\n");

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

app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  console.error("Unhandled error", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});
