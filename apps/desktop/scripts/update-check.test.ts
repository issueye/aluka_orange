import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkForDesktopUpdate, parseReleasePayload } from "../src/host/update-check.ts";

describe("update check", () => {
  it("parses GitHub release JSON without leaking unrelated fields", () => {
    const result = parseReleasePayload("0.1.0", {
      tag_name: "v0.2.0",
      html_url: "https://example.com/releases/v0.2.0",
    });
    assert.equal(result.latest, "0.2.0");
    assert.equal(result.upToDate, false);
    assert.equal(result.url, "https://example.com/releases/v0.2.0");
  });

  it("marks upToDate when latest equals current", () => {
    const result = parseReleasePayload("1.2.3", { tag_name: "v1.2.3" });
    assert.equal(result.upToDate, true);
  });

  it("skips when no URL configured", async () => {
    const prev = process.env.ALUKA_DESKTOP_RELEASES_URL;
    delete process.env.ALUKA_DESKTOP_RELEASES_URL;
    const result = await checkForDesktopUpdate({ currentVersion: "0.1.0" });
    assert.equal(result.skipped, true);
    if (prev !== undefined) process.env.ALUKA_DESKTOP_RELEASES_URL = prev;
  });
});
