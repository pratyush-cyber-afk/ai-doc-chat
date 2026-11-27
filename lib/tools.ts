import { tool } from "ai";
import { z } from "zod";
import { search, type AccessLevel, type SearchResult } from "./search";
import { formatContext } from "./context";

export const makeSearchDocsTool = (
  accessLevel: AccessLevel,
  onResults: (results: SearchResult[]) => void,
) =>
  tool({
    description:
      "Search the Charon Colonial documents. Use it for any question about Charon Colonial, its missions, crew or Asphodel. You may call it again with a different query if the first results don't answer the question.",
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .max(500)
        .describe("What to search for, in plain words"),
    }),
    execute: async ({ query }) => {
      try {
        const results = await search(query, accessLevel);
        onResults(results);
        return formatContext(results);
      } catch (err) {
        console.error("search_docs failed:", err);
        return "Document search is unavailable right now.";
      }
    },
  });
