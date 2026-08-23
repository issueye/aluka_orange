import type { ExtensionAPI } from "@aluka/coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  let helloCount = 0;

  pi.on("session_start", (_event, ctx) => {
    ctx.ui.notify("greet extension loaded", "info");
  });

  // M4/R1 示例：声明式 UI 贡献（v2 槽位：独立视图；兼容 v1 面板渲染路径，不含前端代码）
  pi.contributes({
    id: "greet-demo",
    version: 2,
    title: "问候插件",
    description: "示例：声明式 UI 贡献。「运行命令」把 /hello 预填到输入框，发送后由扩展命令处理。",
    icon: "terminal",
    command: "hello",
    slot: "view.registry",
  });

  // v2「状态栏」演示：槽位贡献 + 数据提供者（contributesData；宿主 3s 轮询拉取）
  pi.contributes({
    id: "greet-counter",
    version: 2,
    title: "问候计数",
    icon: "chart",
    slot: "statusbar",
    when: "aluka.workspaceOpen",
  });
  pi.contributesData("greet-counter", () => ({
    text: `${helloCount} 次问候`,
    kind: helloCount > 0 ? "success" : "info",
  }));

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
      helloCount += 1;
      ctx.ui.notify(`Hello ${args || "world"}!`, "info");
    },
  });
}
