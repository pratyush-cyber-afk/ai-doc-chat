import { z } from "zod";
import { pool } from "../db/client";
import { embed } from "./voyage";

const ACCESS_LEVELS = ["public", "personnel", "survey", "directorate"] as const;
export const AccessLevelSchema = z.enum(ACCESS_LEVELS);
export type AccessLevel = z.infer<typeof AccessLevelSchema>;

const TOP_K = 3;
const MAX_DISTANCE = 0.7;

export type SearchResult = {
  id: string;
  doc_id: string;
  access_level: AccessLevel;
  heading: string;
  title: string;
  content: string;
  distance: number;
};

const allowedLevels = (level: AccessLevel) =>
  ACCESS_LEVELS.slice(0, ACCESS_LEVELS.indexOf(level) + 1);

export const search = async (
  question: string,
  userLevel: AccessLevel,
): Promise<SearchResult[]> => {
  const level = AccessLevelSchema.parse(userLevel);
  const { embeddings } = await embed([question], "query");

  const { rows } = await pool.query<SearchResult>(
    `SELECT id, doc_id, access_level, heading, title, content, embedding <=> $1::vector AS distance
     FROM chunks
     WHERE access_level = ANY($2)
       AND (embedding <=> $1::vector) <= $3
     ORDER BY distance
     LIMIT $4`,
    [JSON.stringify(embeddings[0]), allowedLevels(level), MAX_DISTANCE, TOP_K],
  );
  return rows;
};
