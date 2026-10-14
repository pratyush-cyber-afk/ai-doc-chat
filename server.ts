import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const app = express();
const client = new Anthropic();

app.use(express.json());

const ChatMessageSchema = z.object({
   role: z.enum(["user","assistant"]),
   content: z.string().trim().min(1).max(4000)
});

const ChatRequestSchema = z.object({
   messages: z.array(ChatMessageSchema).min(1).max(50),
}).refine((data) => data.messages[data.messages.length -1].role === "user",{
   message: "The last message must be from the user."
})

const SummarizeRequestSchema = z.object({
  text: z.string().trim().min(1).max(10000),
})

const SummarySchema = z.object({
  title: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
  sentiment: z.enum(["positive","neutral","negative"])
})

const summaryJsonSchema = {
  type: "object",
  properties:{
     title: { type:"string" },
     summary: { type: "string" },
     tags: { type: "array", items: { type: "string" } },
     sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
  },
  required: ["title", "summary", "tags", "sentiment"],
  additionalProperties: false,
}

app.post("/chat", async (req,res)=>{
    const result = ChatRequestSchema.safeParse(req.body);   

    if (!result.success) {
      const firstIssue = result.error.issues[0];
      return res.status(400).json({ error: firstIssue?.message ?? "Invalid request"});
    }
    const { messages } = result.data;
 
      try {
        const response = await client.messages.create({
            model: 'claude-haiku-5-5',
            max_tokens:1500,
            messages,
        });

       const textBlock = response.content.find((b) => b.type === "text");
       const reply = textBlock?.type === "text" ? textBlock.text : "";

        console.log("Usage:", response.usage);
        if (!reply) {
          return res.status(502).json({ error: "Claude didn't return an answer. Please try again." });
          }
        res.json({reply, stop_reason: response.stop_reason});
      } catch (err) {
        console.error(err);
        res.status(500).json({error:"Something went wrong talking to claude"});
      }
});

app.post("/summarize", async(req,res)=>{
  const parsed = SummarizeRequestSchema.safeParse(req.body);
  if(!parsed.success){
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
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
      return res.status(502).json({ error: `Could not summarize (stop reason: ${response.stop_reason}).` });
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
      return res.status(502).json({ error: "Summary didn't match the expected format." });
    }

    res.json(summary.data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong talking to Claude." });
  }
})

app.listen(3000,()=>{
    console.log("Server running at http://localhost:3000")
})