import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateBookGeometry,
  calculateTotalPages,
  clampPage,
  fractionFromPage,
  pageFromFraction,
} from "../src/layout.ts";

test("auto mode uses the same two-page threshold as MD Reader", () => {
  const narrow = calculateBookGeometry(819, 40, "auto", 600, true);
  const wide = calculateBookGeometry(820, 40, "auto", 600, true);
  assert.equal(narrow.pageCount, 1);
  assert.equal(wide.pageCount, 2);
});

test("geometry locks stage, columns, and transform stride together", () => {
  const geometry = calculateBookGeometry(860, 40, "auto", 600, true);
  assert.deepEqual(geometry, {
    pageCount: 2,
    pageWidth: 386,
    stageWidth: 812,
    pageStride: 852,
  });
});

test("maximum page width centers a narrower book stage", () => {
  const geometry = calculateBookGeometry(1600, 40, "double", 600, true);
  assert.equal(geometry.pageWidth, 600);
  assert.equal(geometry.stageWidth, 1240);
  assert.equal(geometry.pageStride, 1280);
});

test("page total follows the rendered column width", () => {
  assert.equal(calculateTotalPages(68120, 852, 40), 80);
  assert.equal(calculateTotalPages(0, 852, 40), 1);
});

test("page positions clamp and survive repagination", () => {
  assert.equal(clampPage(-3, 10), 0);
  assert.equal(clampPage(99, 10), 9);
  const fraction = fractionFromPage(7, 11);
  assert.equal(pageFromFraction(fraction, 21), 14);
});
