import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, it } from "vitest";
import { trackChild, trackedChildCount } from "../src/process-children.ts";

describe("process children tracker", () => {
  it("forgets a child after it exits", async () => {
    const before = trackedChildCount();
    const child = trackChild(spawn(process.execPath, ["-e", "process.exit(0)"], {
      windowsHide: true,
      stdio: "ignore",
    }));
    assert.ok(trackedChildCount() >= before + 1);
    await new Promise<void>((resolve, reject) => {
      child.once("exit", () => resolve());
      child.once("error", reject);
    });
    assert.equal(trackedChildCount(), before);
  });
});
