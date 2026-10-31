import { readFileSync } from "node:fs";
import { z } from "zod";
import { pool } from "../db/client";
import { search, AccessLevelSchema, ACCESS_LEVELS } from "../lib/search";

const GoldenSchema = z.array(
  z.object({
    id: z.string(),
    level: AccessLevelSchema,
    question: z.string(),
    expected_docs: z.array(z.string()),
    expect_empty: z.boolean().optional(),
  }),
);
const golden = GoldenSchema.parse(
  JSON.parse(readFileSync("eval/golden.json", "utf8")),
);

const runMode = async (mode: "vector" | "hybrid") => {
  let answerable = 0,
    hits = 0,
    rrSum = 0,
    offTopic = 0,
    emptyOk = 0,
    leaks = 0;
  const notes: string[] = [];

  for (const q of golden) {
    const results = await search(q.question, q.level, mode);
    const docs = results.map((r) => r.doc_id);

    // Leak check on EVERY question: nothing above the asked level
    for (const r of results)
      if (
        ACCESS_LEVELS.indexOf(r.access_level) > ACCESS_LEVELS.indexOf(q.level)
      ) {
        leaks++;
        notes.push(`LEAK ${q.id}: ${r.id}`);
      }

    if (q.expect_empty) {
      offTopic++;
      if (results.length === 0) emptyOk++;
      else notes.push(`NOT EMPTY ${q.id}: ${docs.join(", ")}`);
    } else if (q.expected_docs.length > 0) {
      answerable++;
      const rank = docs.findIndex((d) => q.expected_docs.includes(d));
      if (rank >= 0) {
        hits++;
        rrSum += 1 / (rank + 1);
      } else
        notes.push(`MISS ${q.id} "${q.question}" got [${docs.join(", ")}]`);
    }
  }

  console.log(`\n=== ${mode} ===`);
  console.log(
    `Hit rate @3:     ${hits}/${answerable} (${((100 * hits) / answerable).toFixed(0)}%)`,
  );
  console.log(`MRR:             ${(rrSum / answerable).toFixed(3)}`);
  console.log(`Off-topic empty: ${emptyOk}/${offTopic}`);
  console.log(`Leaks:           ${leaks}`);
  notes.forEach((n) => console.log("  " + n));
  return leaks;
};

const main = async () => {
  const leaks = (await runMode("vector")) + (await runMode("hybrid"));
  await pool.end();
  if (leaks > 0) process.exit(1); // a leak fails the run, CI-style
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
