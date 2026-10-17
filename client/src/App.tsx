import { useState } from "react";

type ChatMessage = { role : "user" | "assistant"; content:string}

const App = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const newMessages: ChatMessage[] = [...messages,{role:"user",content:input}];
    setMessages([...newMessages, { role:"assistant", content:""}]);
    setInput("");
    setLoading(true);
    setError("");

    const rollback = (msg: string) => {
      setError(msg);
      setMessages(messages);
      setInput(newMessages[newMessages.length - 1].content);
    }

    try {
      const res = await fetch("/chat-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      rollback(data.error ?? "Something went wrong.");
      return;
    }

     const reader = res.body.getReader();
     const decoder = new TextDecoder();
     let fullText = "";


    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      fullText += chunk;

      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        updated[updated.length - 1] = { ...last, content: last.content + chunk };
        return updated;
      });
    }

    if (!fullText.trim()) {
      rollback("Claude didn't return an answer. Please try again.");
    }
  } catch {
    rollback("Could not reach the server. Is it running?");
  } finally {
    setLoading(false);
  }
};

  return (
    <div style={{ maxWidth: 600, margin: "40px auto", fontFamily: "sans-serif",textAlign:"left" }}>
      <h1>My AI Chat</h1>

       <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        {messages.map((m, i) => (
          m.content === "" ? null : (<div
            key={i}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              background: m.role === "user" ? "#4f46e5" : "#f1f1f1",
              color: m.role === "user" ? "white" : "black",
              padding: "8px 12px",
              borderRadius: 12,
              maxWidth: "80%",
              whiteSpace: "pre-wrap",
            }}
          >
            {m.content}
          </div>)
        ))}
        {loading && messages[messages.length - 1]?.content === ""  &&
         <div style={{ color: "#888" }}>Thinking...</div>}
      </div>

      {error && <p style={{ color: "red" }}>{error}</p>}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Ask Claude something..."
          style={{ flex: 1, padding: 8 }}
          disabled={loading}
        />
        <button onClick={sendMessage} disabled={loading}>
          send
        </button>
      </div>
    </div>
  );
}

export default App;