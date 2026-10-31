import { pool } from "../db/client";
import { search, AccessLevelSchema } from "../lib/search";

const main = async () => {
  const question = process.argv[2];
  if (!question)
    throw new Error('Usage: npm run search -- "your question" [access_level]');
  const level = AccessLevelSchema.parse(process.argv[3] ?? "public");

  const results = await search(question, level);

  console.log(`\nQ: ${question}  (as ${level})\n`);
  if (results.length === 0) console.log("No relevant chunks found.");
  for (const r of results) {
    console.log(
      `[score ${r.score.toFixed(4)} | dist ${r.distance.toFixed(3)}] ${r.id} (${r.access_level}) > ${r.heading}`,
    );
    console.log(`   ${r.content.slice(0, 150).replace(/\n+/g, " ")}…\n`);
  }
  await pool.end();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
