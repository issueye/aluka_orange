import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.notify("greet extension loaded", "info");
  });

  // M4 示例：声明式 UI 贡献（宿主侧栏菜单项 + 声明式面板，不含前端代码）
  pi.contributes({
    id: "greet-demo",
    version: 1,
    title: "问候插件",
    description: "示例：声明式 UI 贡献。「运行命令」把 /hello 预填到输入框，发送后由扩展命令处理。",
    icon: "terminal",
    command: "hello",
  });

  pi.registerTool({
    name: "greet",
    label: "Greet",
    description: "Greet someone by name",
    parameters: Type.Object({
      name: Type.String({ description: "Name to greet" }),
    }),
    async execute(_id, params) {
      return {
        content: [{ type: "text", text: `Hello, ${params.name}!` }],
        details: {},
      };
    },
  });

  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello ${args || "world"}!`, "info");
    },
  });
}
