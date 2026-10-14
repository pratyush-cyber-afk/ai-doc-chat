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

app.listen(3000,()=>{
    console.log("Server running at http://localhost:3000")
})