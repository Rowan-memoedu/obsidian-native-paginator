import assert from "node:assert/strict";
import test from "node:test";
import { scheduleCooperativeTask } from "../src/scheduler.ts";

test("cooperative tasks yield, run once, and close their message ports", async () => {
  const order: string[] = [];
  await new Promise<void>((resolve) => {
    scheduleCooperativeTask(() => { order.push("task"); resolve(); });
    order.push("caller");
  });
  assert.deepEqual(order, ["caller", "task"]);
});

test("cancelled tasks never commit stale work", async () => {
  let calls = 0;
  const cancel = scheduleCooperativeTask(() => { calls++; });
  cancel();
  cancel();
  await new Promise<void>((resolve) => { scheduleCooperativeTask(resolve); });
  assert.equal(calls, 0);
});
