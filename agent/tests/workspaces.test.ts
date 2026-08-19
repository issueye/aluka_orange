import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import {
  createTemporaryWorkspace,
  isTemporaryWorkspace,
  normalizeWorkspaceList,
  rememberWorkspace,
  samePath,
  workspaceDisplayName,
} from "../src/desktop/workspaces.ts";

describe("workspaces helpers", () => {
  it("marks mkdtemp dirs as temporary and names them", () => {
    const dir = createTemporaryWorkspace();
    assert.equal(isTemporaryWorkspace(dir), true);
    assert.match(workspaceDisplayName(dir), /^临时工作区/);
    assert.equal(isTemporaryWorkspace(os.homedir()), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("dedupes and remembers workspace paths", () => {
    const a = path.resolve("/tmp/ws-a");
    const b = path.resolve("/tmp/ws-b");
    const list = normalizeWorkspaceList([a, a, `${a}${path.sep}`], b);
    assert.equal(list.some((item) => samePath(item, a)), true);
    assert.equal(list.some((item) => samePath(item, b)), true);
    const remembered = rememberWorkspace(list, b);
    assert.ok(samePath(remembered[0]!, b));
  });
});
