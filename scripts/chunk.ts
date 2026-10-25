import { loadDocs, chunkDoc } from "../lib/chunker";

const chunks = loadDocs().flatMap(chunkDoc);

console.log(`Total chunks: ${chunks.length}`);
for (const level of ["public", "personnel", "survey", "directorate"]) {
  console.log(
    `  ${level}: ${chunks.filter((c) => c.access_level === level).length}`,
  );
}
