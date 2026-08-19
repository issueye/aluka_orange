/**
 * settings.packages（npm: / git:）发现与 pi.extensions[] 入口解析。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  discoverPackageExtensionPaths,
  resolveExtensionEntries,
  resolvePackageRootFromSpec,
} from "../src/extensions/package-paths.ts";

describe("package-paths", () => {
  it("resolves pi.extensions[] entries", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-pkg-"));
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "demo",
        pi: { extensions: ["./a.ts", "./b.ts"] },
      }),
    );
    fs.writeFileSync(path.join(root, "a.ts"), "export default () => {}");
    fs.writeFileSync(path.join(root, "b.ts"), "export default () => {}");
    const entries = resolveExtensionEntries(root);
    assert.equal(entries.length, 2);
    assert.ok(entries[0]?.endsWith(`${path.sep}a.ts`));
    assert.ok(entries[1]?.endsWith(`${path.sep}b.ts`));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("discovers npm: and git: packages from settings like ~/.pi/agent", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "aluka-home-"));
    const piAgent = path.join(home, ".pi", "agent");
    const alukaAgent = path.join(home, ".aluka", "agent");
    const npmPkg = path.join(piAgent, "npm", "node_modules", "demo-ext");
    const gitPkg = path.join(piAgent, "git", "github.com", "acme", "git-ext");
    fs.mkdirSync(npmPkg, { recursive: true });
    fs.mkdirSync(gitPkg, { recursive: true });
    fs.writeFileSync(
      path.join(npmPkg, "package.json"),
      JSON.stringify({ name: "demo-ext", pi: { extensions: ["./src/index.ts"] } }),
    );
    fs.mkdirSync(path.join(npmPkg, "src"), { recursive: true });
    fs.writeFileSync(path.join(npmPkg, "src", "index.ts"), "export default () => {}");
    fs.writeFileSync(
      path.join(gitPkg, "package.json"),
      JSON.stringify({ name: "git-ext", pi: { extensions: ["./index.ts"] } }),
    );
    fs.writeFileSync(path.join(gitPkg, "index.ts"), "export default () => {}");
    fs.mkdirSync(piAgent, { recursive: true });
    fs.writeFileSync(
      path.join(piAgent, "settings.json"),
      JSON.stringify({
        packages: ["npm:demo-ext", "git:github.com/acme/git-ext"],
      }),
    );

    const npmRoot = resolvePackageRootFromSpec("npm:demo-ext", [piAgent, alukaAgent]);
    assert.equal(npmRoot, npmPkg);
    const gitRoot = resolvePackageRootFromSpec("git:github.com/acme/git-ext", [piAgent, alukaAgent]);
    assert.equal(gitRoot, gitPkg);

    const paths = discoverPackageExtensionPaths({
      cwd: home,
      agentDirs: [piAgent, alukaAgent],
    });
    assert.equal(paths.length, 2);
    assert.ok(paths.some((p) => p.replace(/\\/g, "/").endsWith("demo-ext/src/index.ts")));
    assert.ok(paths.some((p) => p.replace(/\\/g, "/").endsWith("git-ext/index.ts")));

    fs.rmSync(home, { recursive: true, force: true });
  });
});
