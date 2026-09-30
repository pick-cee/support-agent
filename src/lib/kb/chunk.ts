import { createHash } from "node:crypto";

import { CHUNK_MAX_CHARS } from "@/lib/constants";

// Turns the approved knowledge base into chunks along its own structure
// (DESIGN §8): the headings are exactly the questions callers ask. Pure: the
// same file always gives the same chunks, ids and version.

export type KbChunk = {
  chunk_id: string;
  source_title: string;
  section_path: string;
  text: string;
  source_summary: string;
};

export type KbDocument = { kb_version: string; chunks: KbChunk[] };

export function kbVersion(markdown: string): string {
  return createHash("sha256").update(markdown.replace(/\r\n/g, "\n")).digest("hex");
}

/** A stable hash of the section path, so logs keep pointing at the same thing across re-ingests. */
export function chunkId(sectionPath: string): string {
  return `kb-${createHash("sha256").update(sectionPath).digest("hex").slice(0, 12)}`;
}

/** The first sentence, trimmed to 160 characters. Built by code; no model writes it. */
export function summarise(text: string): string {
  const flat = text.replace(/^[-*]\s+/gm, "").replace(/\s+/g, " ").trim();
  const sentence = flat.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? flat;
  return sentence.length > 160 ? `${sentence.slice(0, 157).replace(/\s+\S*$/, "")}...` : sentence;
}

function splitLong(body: string): string[] {
  if (body.length <= CHUNK_MAX_CHARS) return [body];
  const parts: string[] = [];
  let current = "";
  for (const paragraph of body.split(/\n\s*\n/)) {
    if (current && current.length + paragraph.length + 2 > CHUNK_MAX_CHARS) {
      parts.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export function chunkKnowledgeBase(markdown: string): KbDocument {
  const text = markdown.replace(/\r\n/g, "\n");
  const chunks: KbChunk[] = [];
  let section = "";
  let subsection = "";
  let body: string[] = [];

  const flush = () => {
    const content = body.join("\n").trim();
    body = [];
    if (!section || !content) return;
    const path = subsection ? `${section} > ${subsection}` : `${section} > Overview`;
    const parts = splitLong(content);
    parts.forEach((part, index) => {
      const partPath = parts.length > 1 ? `${path} (part ${index + 1})` : path;
      chunks.push({ chunk_id: chunkId(partPath), source_title: section, section_path: partPath, text: part, source_summary: summarise(part) });
    });
  };

  for (const line of text.split("\n")) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    const h3 = /^###\s+(.+?)\s*$/.exec(line);
    if (/^#\s+/.test(line)) {
      flush();
      section = "";
      subsection = "";
    } else if (h2) {
      flush();
      section = h2[1]!;
      subsection = "";
    } else if (h3) {
      flush();
      subsection = h3[1]!;
    } else {
      body.push(line);
    }
  }
  flush();
  return { kb_version: kbVersion(text), chunks };
}
