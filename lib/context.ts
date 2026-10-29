import type { SearchResult } from "./search";

const stripFenceTags = (text: string) =>
  text.replace(/<\/?documents?\b[^>]*>/gi, "");

export const formatContext = (results: SearchResult[]) => {
  if (results.length === 0) {
    return "<documents>\nNo relevant documents found.\n</documents>";
  }
  const docs = results.map(
    (r, i) =>
      `<document index="${i + 1}" source="${r.doc_id}">\n${stripFenceTags(r.content)}\n</document>`,
  );
  return `<documents>\n${docs.join("\n")}\n</documents>`;
};
