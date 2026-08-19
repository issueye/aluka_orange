#!/usr/bin/env node

/**
 * CLI 入口文件
 *
 * 作为 aluka 命令行工具的启动点，调用 main() 函数执行主逻辑。
 * 成功时以 main() 返回的退出码退出进程，
 * 失败时将错误信息写入 stderr 并以退出码 1 终止。
 */
import { main } from "./main.ts";

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : error}\n`);
    process.exit(1);
  },
);
