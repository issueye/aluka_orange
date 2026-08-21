import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import { SessionManager } from "../src/session/manager.ts";
import { CURRENT_SESSION_VERSION, parseSessionEntries } from "../src/session/format.ts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aluka-session-"));
}

describe("SessionManager tree format", () => {
  it("creates a v3 header and appends messages as a parent/child chain", () => {
    const dir = tmpDir();
    const session = SessionManager.create(dir, "demo.jsonl", dir);
    session.append({ type: "user", text: "hello" });
    session.append({
      type: "turn",
      messages: [
        { role: "user", content: [{ type: "text", text: "hello" }] },
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
      ],
    });

    const header = session.getHeader();
    assert.equal(header?.type, "session");
    assert.equal(header?.version, CURRENT_SESSION_VERSION);
    assert.equal(header?.cwd, path.resolve(dir));

    const entries = session.getEntries();
    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.type, "message");
    assert.equal(entries[0]?.parentId, null);
    assert.equal(entries[1]?.type, "message");
    assert.equal(entries[1]?.parentId, entries[0]?.id);

    const ctx = session.buildSessionContext();
    assert.equal(ctx.messages.length, 2);
    assert.equal(ctx.messages[0]?.role, "user");
    assert.equal(ctx.messages[1]?.role, "assistant");

    const listed = SessionManager.list(dir);
    assert.equal(listed[0]?.title, "hello");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("list() summary cache refreshes when a session file changes", () => {
    const dir = tmpDir();
    const session = SessionManager.create(dir, "cached.jsonl", dir);
    session.append({ type: "user", text: "first" });

    const before = SessionManager.list(dir);
    assert.equal(before[0]?.title, "first");

    // 追加内容后（size/mtime 变化），缓存必须失效并给出新摘要
    session.append({ type: "user", text: "second question" });
    const after = SessionManager.list(dir);
    assert.equal(after[0]?.title, "first");
    assert.equal(after[0]?.messageCount, 2);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("migrates legacy linear user/turn files on open", () => {
    const dir = tmpDir();
    const file = path.join(dir, "old.jsonl");
    fs.writeFileSync(
      file,
      [
        JSON.stringify({ id: "u1", type: "user", role: "user", text: "legacy hello", timestamp: Date.now() }),
        JSON.stringify({
          id: "t1",
          type: "turn",
          timestamp: Date.now(),
          messages: [{ role: "assistant", content: [{ type: "text", text: "legacy hi" }], usage: { input: 2, output: 3 } }],
        }),
      ].join("\n") + "\n",
    );

    const opened = SessionManager.open(dir, "old", dir);
    const header = opened.getHeader();
    assert.equal(header?.version, CURRENT_SESSION_VERSION);
    assert.equal(opened.getEntries().every((entry) => entry.type === "message"), true);
    const messages = opened.buildSessionContext().messages;
    assert.equal(messages[0]?.role, "user");
    assert.equal(messages[1]?.role, "assistant");

    const rewritten = parseSessionEntries(fs.readFileSync(file, "utf8"));
    assert.equal(rewritten[0]?.type, "session");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("names sessions and branches without deleting history", () => {
    const dir = tmpDir();
    const session = SessionManager.create(dir, undefined, dir);
    session.appendMessage({ role: "user", content: [{ type: "text", text: "A" }] });
    const first = session.getLeafId()!;
    session.appendMessage({ role: "assistant", content: [{ type: "text", text: "A reply" }] });
    session.appendSessionInfo("Approach A");
    assert.equal(session.getSessionName(), "Approach A");

    session.branch(first);
    session.appendMessage({ role: "assistant", content: [{ type: "text", text: "B reply" }] });
    const ctx = session.buildSessionContext();
    assert.equal(ctx.messages.length, 2);
    assert.equal(ctx.messages[1]?.role, "assistant");
    assert.equal(session.getEntries().length >= 4, true);

    const forked = session.createBranchedSession(session.getLeafId()!);
    assert.ok(forked && fs.existsSync(forked));
    assert.equal(session.buildSessionContext().messages.length, 2);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("supports in-memory sessions", () => {
    const session = SessionManager.inMemory("/tmp/ws");
    assert.equal(session.file, "");
    session.appendMessage({ role: "user", content: [{ type: "text", text: "mem" }] });
    assert.equal(session.buildSessionContext().messages[0]?.role, "user");
    assert.equal(session.isPersisted(), false);
  });
});
