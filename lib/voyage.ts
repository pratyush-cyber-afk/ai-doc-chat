import { z } from "zod";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-4";
export const DIMENSIONS = 1024;

const VoyageResponseSchema = z.object({
  data: z.array(
    z.object({ embedding: z.array(z.number()), index: z.number() }),
  ),
  usage: z.object({ total_tokens: z.number() }),
});

export const embed = async (
  texts: string[],
  inputType: "document" | "query",
) => {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY is not set");

  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input: texts, model: MODEL, input_type: inputType }),
  });
  if (!res.ok)
    throw new Error(`Voyage error ${res.status}: ${await res.text()}`);

  const body = VoyageResponseSchema.parse(await res.json());
  const embeddings = body.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
  if (embeddings.length !== texts.length)
    throw new Error("Embedding count mismatch");
  if (embeddings.some((e) => e.length !== DIMENSIONS))
    throw new Error("Wrong embedding size");
  return { embeddings, tokens: body.usage.total_tokens };
};
