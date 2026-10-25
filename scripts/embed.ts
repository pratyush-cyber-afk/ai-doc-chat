import { z } from "zod";
import { pool } from "../db/client";
import { loadDocs, chunkDoc } from "../lib/chunker";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-4";
const DIMENSIONS = 1024;

const VoyageResponseSchema = z.object({
  data: z.array(
    z.object({ embedding: z.array(z.number()), index: z.number() }),
  ),
  usage: z.object({ total_tokens: z.number() }),
});

const embedDocuments = async (texts: string[]) => {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY is not set");

  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: texts,
      model: MODEL,
      input_type: "document",
    }),
  });
  if (!res.ok)
    throw new Error(`Voyage error ${res.status}: ${await res.text()}`);

  const body = VoyageResponseSchema.parse(await res.json());
  const embeddings = body.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
  return { embeddings, tokens: body.usage.total_tokens };
};

const main = async () => {
  const chunks = loadDocs().flatMap(chunkDoc);
  const { embeddings, tokens } = await embedDocuments(
    chunks.map((c) => c.text),
  );

  if (embeddings.length !== chunks.length)
    throw new Error("Embedding count mismatch");
  if (embeddings.some((e) => e.length !== DIMENSIONS))
    throw new Error("Wrong embedding size");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const [i, c] of chunks.entries()) {
      await client.query(
        `INSERT INTO chunks (id, doc_id, chunk_index, access_level, title, heading, content, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           access_level = EXCLUDED.access_level,
           title = EXCLUDED.title,
           heading = EXCLUDED.heading,
           content = EXCLUDED.content,
           embedding = EXCLUDED.embedding,
           updated_at = now()`,
        [
          c.id,
          c.doc_id,
          c.chunk_index,
          c.access_level,
          c.title,
          c.heading,
          c.text,
          JSON.stringify(embeddings[i]),
        ],
      );
    }

    await client.query("DELETE FROM chunks WHERE NOT (id = ANY($1))", [
      chunks.map((c) => c.id),
    ]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const { rows } = await pool.query(
    "SELECT count(*)::int AS count FROM chunks",
  );
  console.log(
    `Embedded ${chunks.length} chunks ✅ rows in DB: ${rows[0].count} | tokens used: ${tokens}`,
  );
  await pool.end();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
