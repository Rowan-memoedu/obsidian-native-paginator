import assert from "node:assert/strict";
import test from "node:test";
import { moveReadingFileState } from "../src/file-state.ts";

test("moving an enabled note preserves its reading mode and position", () => {
  const state = { enabledFiles: { "Books/book.md": true }, positions: { "Books/book.md": 0.37 } };
  assert.equal(moveReadingFileState(state, "Books/book.md", "Literature/book.md"), true);
  assert.deepEqual(state, {
    enabledFiles: { "Literature/book.md": true },
    positions: { "Literature/book.md": 0.37 },
  });
});

test("folder moves follow descendants but do not match similarly named folders", () => {
  const state = {
    enabledFiles: { "Books/a.md": true, "Books/nested/b.md": false, "Bookshelf/c.md": true },
    positions: { "Books/nested/b.md": 0.2, "Bookshelf/c.md": 0.8 },
  };
  moveReadingFileState(state, "Books", "Library");
  assert.deepEqual(state, {
    enabledFiles: { "Library/a.md": true, "Library/nested/b.md": false, "Bookshelf/c.md": true },
    positions: { "Library/nested/b.md": 0.2, "Bookshelf/c.md": 0.8 },
  });
});

test("existing destination choices and positions remain authoritative", () => {
  const state = {
    enabledFiles: { "old.md": true, "new.md": false },
    positions: { "old.md": 0.3, "new.md": 0.9 },
  };
  moveReadingFileState(state, "old.md", "new.md");
  assert.deepEqual(state, { enabledFiles: { "new.md": false }, positions: { "new.md": 0.9 } });
  assert.equal(moveReadingFileState(state, "missing.md", "other.md"), false);
  assert.equal(moveReadingFileState(state, "new.md", "new.md"), false);
});
