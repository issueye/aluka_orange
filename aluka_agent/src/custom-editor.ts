/**
 * 自定义编辑器组件
 *
 * 实现了一个简易的文本编辑器，用于 TUI 模式下的文本输入。
 * 支持基本的文本输入和退格操作，可被扩展通过 keybindings 自定义行为。
 */
import type { EditorComponent, EditorTheme, KeyId, TUI } from "./tui/index.ts";

export class CustomEditor implements EditorComponent {
  /** 编辑器中的文本内容 */
  protected text = "";

  constructor(
    /** TUI 上下文引用 */
    protected tui: TUI,
    /** 编辑器主题配置 */
    protected theme: EditorTheme,
    /** 可选的自定义按键绑定处理器 */
    protected keybindings?: { handle(data: string): boolean },
  ) {}

  /** 获取当前编辑器中的文本 */
  getText(): string {
    return this.text;
  }

  /** 设置编辑器中的文本（覆盖） */
  setText(text: string): void {
    this.text = text;
  }

  /**
   * 处理键盘输入
   * 优先交由 keybindings 处理；若未处理则执行默认行为：
   * - 退格键 (\x7f 或 \b) 删除最后一个字符
   * - 其他字符追加到文本末尾
   */
  handleInput(data: string): void {
    if (this.keybindings?.handle(data)) return;
    if (data === "\x7f" || data === "\b") {
      this.text = this.text.slice(0, -1);
      return;
    }
    this.text += data;
  }

  /** 将文本按行拆分，用于渲染输出 */
  render(): string[] {
    return this.text.split("\n");
  }
}

export type { KeyId };
