import { z } from "zod";
import { pool } from "../db/client";
import { embed } from "./voyage";

const ACCESS_LEVELS = ["public", "personnel", "survey", "directorate"] as const;
export const AccessLevelSchema = z.enum(ACCESS_LEVELS);
export type AccessLevel = z.infer<typeof AccessLevelSchema>;

const TOP_K = 3;
const MAX_DISTANCE = 0.7;
const CANDIDATES = 20;
const RRF_K = 60;

export type SearchResult = {
  id: string;
  doc_id: string;
  access_level: AccessLevel;
  heading: string;
  title: string;
  content: string;
  distance: number;
  score: number;
};

const allowedLevels = (level: AccessLevel) =>
  ACCESS_LEVELS.slice(0, ACCESS_LEVELS.indexOf(level) + 1);

export const search = async (
  question: string,
  userLevel: AccessLevel,
): Promise<SearchResult[]> => {
  const level = AccessLevelSchema.parse(userLevel);
  const { embeddings } = await embed([question], "query");
  const keywordQuery = question.trim().split(/\s+/).join(" or ");

  const { rows } = await pool.query<SearchResult>(
    `WITH vector AS (
     SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rank
     FROM chunks
     WHERE access_level = ANY($2) AND (embedding <=> $1::vector) <= $3
     ORDER BY embedding <=> $1::vector LIMIT $5
   ),
   keyword AS (
     SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank(content_tsv, q) DESC) AS rank
     FROM chunks, websearch_to_tsquery('english', $6) AS q
     WHERE access_level = ANY($2) AND content_tsv @@ q
     ORDER BY ts_rank(content_tsv, q) DESC LIMIT $5
   )
   SELECT c.id, c.doc_id, c.access_level, c.heading, c.title, c.content,
          c.embedding <=> $1::vector AS distance,
          (COALESCE(1.0 / ($7 + v.rank), 0) + COALESCE(1.0 / ($7 + k.rank), 0))::float8 AS score
   FROM vector v
   FULL OUTER JOIN keyword k ON v.id = k.id
   JOIN chunks c ON c.id = COALESCE(v.id, k.id)
   ORDER BY score DESC
   LIMIT $4`,
    [
      JSON.stringify(embeddings[0]),
      allowedLevels(level),
      MAX_DISTANCE,
      TOP_K,
      CANDIDATES,
      keywordQuery,
      RRF_K,
    ],
  );
  return rows;
};
