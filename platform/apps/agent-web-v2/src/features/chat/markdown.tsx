/**
 * Chat keeps importing from "./markdown"; the implementation lives in the
 * shared location `src/components/markdown.tsx` so the Tasks artifact preview
 * (spec §7.6) reuses the same renderer.
 */
export { Markdown, splitThinking, type ThinkingSegment } from "@/components/markdown";
