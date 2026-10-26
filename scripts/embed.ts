import { pool } from "../db/client";
import { loadDocs, chunkDoc } from "../lib/chunker";
import { embed } from "../lib/voyage";

const main = async () => {
  const chunks = loadDocs().flatMap(chunkDoc);
  const { embeddings, tokens } = await embed(
    chunks.map((c) => c.text),
    "document",
  );

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
