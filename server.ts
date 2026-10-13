import express from "express";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
const client = new Anthropic();

app.use(express.json());

type ChatMessage = { role: "user" | "assistant"; content: string };

app.post("/chat", async (req,res)=>{
    const messages = req.body?.messages;

    if(!Array.isArray(messages) || messages.length === 0 || messages.length > 50){
        return res.status(400).json({error:"Send a 'messages' array (1-50 items)."});
      }

    const valid = messages.every(
         (m: any) => 
             (m?.role === "user" || m?.role === "assistant") &&
              typeof m?.content === "string" &&
              m.content.trim() !== "" &&
              m.content.length <= 4000
    );
    if (!valid) {
    return res.status(400).json({ error: "Each message needs a valid role and text." });
  }

  if (messages[messages.length - 1].role !== "user") {
    return res.status(400).json({ error: "The last message must be from the user." });
  }

      try {
        const response = await client.messages.create({
            model: 'claude-haiku-5-5',
            max_tokens:1500,
            messages:messages as ChatMessage[]
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