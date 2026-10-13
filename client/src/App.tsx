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
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        setMessages(messages);
        setInput(newMessages[newMessages.length -1].content);
        return;
      }

      setMessages([...newMessages, { role: "assistant", content: data.reply }]);
    } catch {
      setError("Could not reach the server. Is it running?");
      setMessages(messages);
      setInput(newMessages[newMessages.length - 1].content);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: "40px auto", fontFamily: "sans-serif",textAlign:"left" }}>
      <h1>My AI Chat</h1>

       <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        {messages.map((m, i) => (
          <div
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
          </div>
        ))}
        {loading && <div style={{ color: "#888" }}>Thinking...</div>}
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