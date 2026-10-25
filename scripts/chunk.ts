import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";

const DOCS_DIR = path.join(process.cwd(), "data", "docs");

const FrontmatterSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  access_level: z.enum(["public", "personnel", "survey", "directorate"]),
  doc_type: z.string().min(1),
  date: z.coerce.date(),
});

type Doc = z.infer<typeof FrontmatterSchema> & { body: string };

const loadDocs = (): Doc[] => {
  const files = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md"));

  return files.map((file) => {
    const raw = fs.readFileSync(path.join(DOCS_DIR, file), "utf8");
    const { data, content } = matter(raw, {
      engines: {
        javascript: () => {
          throw new Error(`JS frontmatter not allowed: ${file}`);
        },
      },
    });
    const meta = FrontmatterSchema.parse(data);
    return { ...meta, body: content.trim() };
  });
};

type Section = { heading: string; text: string };

const splitIntoSections = (body: string): Section[] => {
  const sections: Section[] = [];
  let current: string[] = [];
  let inCodeBlock = false;

  const flush = () => {
    const text = current.join("\n").trim();
    if (text) {
      const firstLine = text.split("\n")[0];
      const heading = firstLine
        .replace(/^#+\s*/, "")
        .replace(/\*\*/g, "")
        .trim();
      sections.push({ heading, text });
    }
    current = [];
  };
  for (const line of body.split("\n")) {
    if (line.trim().startsWith("```")) inCodeBlock = !inCodeBlock;

    if (!inCodeBlock && line.trim() === "---") {
      flush();
      continue;
    }
    if (!inCodeBlock && line.startsWith("## ")) flush();
    current.push(line);
  }
  flush();
  return sections;
};

const MAX_CHARS = 800;
const OVERLAP_MAX = 300;

const splitBySize = (text: string): string[] => {
  if (text.length <= MAX_CHARS) return [text];

  const paragraphs = text.split(/\n\s*\n/);
  const pieces: string[] = [];
  let current: string[] = [];

  for (const para of paragraphs) {
    const candidate = [...current, para].join("\n\n");
    if (candidate.length > MAX_CHARS && current.length > 0) {
      pieces.push(current.join("\n\n"));
      const last = current[current.length - 1];
      const canOverlap =
        last.length <= OVERLAP_MAX && last.length + para.length <= MAX_CHARS;
      current = canOverlap ? [last] : [];
    }
    current.push(para);
  }
  if (current.length > 0) pieces.push(current.join("\n\n"));
  return pieces;
};

type Chunk = {
  id: string;
  doc_id: string;
  chunk_index: number;
  access_level: Doc["access_level"];
  title: string;
  heading: string;
  text: string;
};

const chunkDoc = (doc: Doc): Chunk[] => {
  const pieces = splitIntoSections(doc.body).flatMap((s) =>
    splitBySize(s.text).map((text) => ({ heading: s.heading, text })),
  );

  return pieces.map((p, i) => ({
    id: `${doc.id}#${i}`,
    doc_id: doc.id,
    chunk_index: i,
    access_level: doc.access_level,
    title: doc.title,
    heading: p.heading,
    text: `${doc.title} > ${p.heading}\n\n${p.text}`,
  }));
};

const chunks = loadDocs().flatMap(chunkDoc);

console.log(`Total chunks: ${chunks.length}`);
for (const level of ["public", "personnel", "survey", "directorate"]) {
  console.log(
    `  ${level}: ${chunks.filter((c) => c.access_level === level).length}`,
  );
}

const sample = chunks.find((c) => c.id === "doc-07-okafor-science-log#6");
console.log("\nSample chunk:\n", sample);
