import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FASTREAD_ALGORITHM,
  DEFAULT_FASTREAD_COMMON_WORDS,
  fastReadHighlightLength,
  findFastReadMatches,
  parseCommonWords,
  parseFastReadAlgorithm,
  splitFastReadWord,
  withFastReadRestRatio,
} from "../src/fastread.ts";

const algorithm = parseFastReadAlgorithm(DEFAULT_FASTREAD_ALGORITHM);
const commonWords = parseCommonWords(DEFAULT_FASTREAD_COMMON_WORDS);

test("recommended algorithm maps word lengths correctly", () => {
  assert.deepEqual(algorithm, { sizes: [0, 0, 0, 2, 2], restRatio: 0.45 });
  assert.equal(fastReadHighlightLength("a", algorithm), 0);
  assert.equal(fastReadHighlightLength("the", algorithm), 0);
  assert.equal(fastReadHighlightLength("read", algorithm), 2);
  assert.equal(fastReadHighlightLength("words", algorithm), 2);
  assert.equal(fastReadHighlightLength("reader", algorithm), 3);
  assert.equal(fastReadHighlightLength("development", algorithm), 5);
});

test("recommended examples split exactly", () => {
  const split = (word: string) => splitFastReadWord(word, algorithm, commonWords, true);
  assert.equal(split("a"), null);
  assert.equal(split("an"), null);
  assert.equal(split("the"), null);
  assert.deepEqual(split("read"), { highlight: "re", rest: "ad" });
  assert.deepEqual(split("words"), { highlight: "wo", rest: "rds" });
  assert.deepEqual(split("reader"), { highlight: "rea", rest: "der" });
  assert.deepEqual(split("development"), { highlight: "devel", rest: "opment" });
  assert.deepEqual(split("information"), { highlight: "infor", rest: "mation" });
  assert.deepEqual(split("recognition"), { highlight: "recog", rest: "nition" });
});

test("common-word exclusion is editable and case-insensitive", () => {
  const editedCommonWords = parseCommonWords("read");
  assert.equal(splitFastReadWord("READ", algorithm, editedCommonWords, true), null);
  assert.deepEqual(splitFastReadWord("READ", algorithm, editedCommonWords, false), {
    highlight: "RE",
    rest: "AD",
  });
});

test("invalid algorithm falls back to the recommended one", () => {
  assert.deepEqual(parseFastReadAlgorithm("0 nope 2"), algorithm);
});

test("the final token remains the long-word ratio for variable-length formulas", () => {
  const originalFormat = parseFastReadAlgorithm("0 1 1 2 0.4");
  assert.deepEqual(originalFormat, { sizes: [0, 1, 1, 2], restRatio: 0.4 });
  assert.equal(fastReadHighlightLength("words", originalFormat), 2);
  assert.equal(withFastReadRestRatio("0 0 0 2 2 0.45", 0.35), "0 0 0 2 2 0.35");
});

test("cached visible-page rendering receives exact text offsets without changing source text", () => {
  const source = "a read development";
  const matches = findFastReadMatches(source, {
    algorithm: DEFAULT_FASTREAD_ALGORITHM,
    excludeCommonWords: true,
    commonWords: DEFAULT_FASTREAD_COMMON_WORDS,
    dimRest: false,
  });
  assert.deepEqual(matches.map(({ start, highlightEnd, end, split }) => ({
    start,
    highlightEnd,
    end,
    split,
  })), [
    { start: 2, highlightEnd: 4, end: 6, split: { highlight: "re", rest: "ad" } },
    { start: 7, highlightEnd: 12, end: 18, split: { highlight: "devel", rest: "opment" } },
  ]);
  assert.equal(source, "a read development");
});
