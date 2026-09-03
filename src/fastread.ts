export const DEFAULT_FASTREAD_ALGORITHM = "0 0 0 2 2 0.45";
export const DEFAULT_FASTREAD_COMMON_WORDS = "a, an, the, of, to, in, is, and";

export interface FastReadOptions {
  algorithm: string;
  excludeCommonWords: boolean;
  commonWords: string;
  dimRest: boolean;
}

export interface FastReadSplit {
  highlight: string;
  rest: string;
}

export interface ParsedFastReadAlgorithm {
  sizes: number[];
  restRatio: number;
}

export interface FastReadMatch {
  start: number;
  highlightEnd: number;
  end: number;
  word: string;
  split: FastReadSplit;
}

const FALLBACK_ALGORITHM: ParsedFastReadAlgorithm = {
  sizes: [0, 0, 0, 2, 2],
  restRatio: 0.45,
};

const LATIN_WORD = /\p{Script=Latin}+/gu;
const SKIP_SELECTOR = [
  "a",
  "code",
  "pre",
  "kbd",
  "samp",
  "script",
  "style",
  "textarea",
  "input",
  "button",
  "svg",
  "math",
  "mjx-container",
  ".katex",
  ".MathJax",
  ".math",
  ".math-block",
  ".math-inline",
  ".frontmatter",
  ".metadata-container",
  ".fastread-highlight",
  ".fastread-rest",
].join(",");

export function parseFastReadAlgorithm(value: string): ParsedFastReadAlgorithm {
  const parts = value.trim().split(/[\s,;]+/).filter(Boolean);
  if (parts[0] === "+" || parts[0] === "-") parts.shift();
  if (parts.length < 2) return { ...FALLBACK_ALGORITHM, sizes: [...FALLBACK_ALGORITHM.sizes] };

  const parsed = parts.map(Number);
  const restRatio = parsed.at(-1);
  const sizes = parsed.slice(0, -1);
  if (
    restRatio === undefined
    || !Number.isFinite(restRatio)
    || restRatio < 0
    || restRatio > 1
    || sizes.some((item) => !Number.isFinite(item) || item < 0)
  ) {
    return { ...FALLBACK_ALGORITHM, sizes: [...FALLBACK_ALGORITHM.sizes] };
  }
  return {
    sizes: sizes.map((item) => Math.round(item)),
    restRatio,
  };
}

export function withFastReadRestRatio(value: string, restRatio: number): string {
  const algorithm = parseFastReadAlgorithm(value);
  return [...algorithm.sizes, Math.max(0, Math.min(1, restRatio))].join(" ");
}

export function parseCommonWords(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase("en")
      .split(/[\s,;]+/)
      .map((word) => word.trim())
      .filter(Boolean),
  );
}

export function fastReadHighlightLength(word: string, algorithm: ParsedFastReadAlgorithm): number {
  const letters = Array.from(word);
  if (letters.length === 0) return 0;
  const index = letters.length - 1;
  const count = index < algorithm.sizes.length
    ? algorithm.sizes[index] ?? 0
    : Math.ceil(letters.length * algorithm.restRatio);
  return Math.max(0, Math.min(letters.length, count));
}

export function splitFastReadWord(
  word: string,
  algorithm: ParsedFastReadAlgorithm,
  commonWords: Set<string>,
  excludeCommonWords: boolean,
): FastReadSplit | null {
  if (excludeCommonWords && commonWords.has(word.toLocaleLowerCase("en"))) return null;
  const count = fastReadHighlightLength(word, algorithm);
  if (count <= 0) return null;
  const letters = Array.from(word);
  return {
    highlight: letters.slice(0, count).join(""),
    rest: letters.slice(count).join(""),
  };
}

export function collectFastReadTextNodes(root: HTMLElement): Text[] {
  const documentRef = root.ownerDocument;
  const nodeFilter = documentRef.defaultView?.NodeFilter ?? NodeFilter;
  const walker = documentRef.createTreeWalker(root, nodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest(SKIP_SELECTOR)) return nodeFilter.FILTER_REJECT;
      LATIN_WORD.lastIndex = 0;
      return LATIN_WORD.test(node.nodeValue ?? "")
        ? nodeFilter.FILTER_ACCEPT
        : nodeFilter.FILTER_REJECT;
    },
  });
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  return textNodes;
}

export function findFastReadMatches(text: string, options: FastReadOptions): FastReadMatch[] {
  const algorithm = parseFastReadAlgorithm(options.algorithm);
  const commonWords = parseCommonWords(options.commonWords);
  LATIN_WORD.lastIndex = 0;
  const matches: FastReadMatch[] = [];
  for (const match of text.matchAll(LATIN_WORD)) {
    const index = match.index ?? 0;
    const word = match[0];
    const split = splitFastReadWord(
      word,
      algorithm,
      commonWords,
      options.excludeCommonWords,
    );
    if (!split) continue;
    matches.push({
      start: index,
      highlightEnd: index + split.highlight.length,
      end: index + word.length,
      word,
      split,
    });
  }
  return matches;
}
