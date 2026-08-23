import type { ExtensionAPI } from "@aluka/coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash") {
      const command = "command" in event.input ? String(event.input.command ?? "") : "";
      if (command.includes("rm -rf") || command.includes("del /s")) {
        const ok = await ctx.ui.confirm("Dangerous command", `Allow: ${command}?`);
        if (!ok) return { block: true, reason: "Blocked by guard extension" };
      }
    }
  });
}
