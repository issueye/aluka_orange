export default function (pi) {
  pi.registerTool({
    name: "tiny_ping",
    description: "fixture ping",
    parameters: { type: "object", properties: {} },
    async execute() {
      return { content: [{ type: "text", text: "pong" }] };
    },
  });
}
