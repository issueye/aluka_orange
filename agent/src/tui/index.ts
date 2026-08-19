/**
 * TUI (终端用户界面) 模块
 *
 * 提供最小化的 TUI 组件接口，使 pi-agent 兼容的扩展能够正常加载。
 * 当前实现为简化版本，不完整模拟交互式自定义组件。
 *
 * 主要提供：
 * - Component: 基础组件接口
 * - TUI: 界面容器接口
 * - 各种 UI 组件类（Text、Container、SelectList 等）
 * - 编辑器和自动补全相关接口
 */

/** 按键标识符类型 */
export type KeyId = string;

/**
 * 基础组件接口
 * 所有 TUI 组件都需要实现此接口
 */
export interface Component {
  /** 渲染组件为文本行数组 */
  render?(width: number): string[];
  /** 处理键盘输入 */
  handleInput?(data: string): void;
  /** 请求重新渲染 */
  invalidate?(): void;
  /** 释放组件资源 */
  dispose?(): void;
}

/**
 * TUI 界面容器接口
 * 管理组件树的添加、移除和渲染请求
 */
export interface TUI {
  /** 请求重新渲染整个界面 */
  requestRender(): void;
  /** 添加子组件 */
  add(child: Component): void;
  /** 移除子组件 */
  remove(child: Component): void;
}

/** 编辑器主题配置 */
export interface EditorTheme {
  /** 边框颜色 */
  borderColor?: string;
  /** 聚焦时的边框颜色 */
  focusedBorderColor?: string;
}

/**
 * 编辑器组件接口
 * 扩展编辑器需要实现此接口以支持文本读写
 */
export interface EditorComponent extends Component {
  /** 获取编辑器中的文本 */
  getText(): string;
  /** 设置编辑器中的文本 */
  setText(text: string): void;
}

/**
 * 覆盖层（Overlay）句柄
 * 用于控制浮动覆盖层的显示和隐藏
 */
export interface OverlayHandle {
  hide(): void;
  show(): void;
  close(): void;
}

/** 覆盖层选项 */
export interface OverlayOptions {
  /** 宽度（数字或百分比字符串） */
  width?: number | string;
  /** 高度（数字或百分比字符串） */
  height?: number | string;
  /** 锚定位置 */
  anchor?: string;
}

/** 自动补全项 */
export interface AutocompleteItem {
  /** 补全值 */
  value: string;
  /** 显示标签 */
  label?: string;
  /** 描述信息 */
  description?: string;
}

/** 自动补全提供者接口 */
export interface AutocompleteProvider {
  /** 获取指定前缀的补全建议 */
  getCompletions(prefix: string): AutocompleteItem[] | Promise<AutocompleteItem[]>;
}

/**
 * 文本组件
 * 最简单的组件，只渲染纯文本
 */
export class Text implements Component {
  constructor(public text = "", public _style?: unknown) {}
  render(): string[] {
    return this.text.split("\n");
  }
}

/**
 * 容器组件
 * 可包含多个子组件，渲染时将所有子组件的输出合并
 */
export class Container implements Component {
  children: Component[] = [];
  add(child: Component): this {
    this.children.push(child);
    return this;
  }
  render(width: number): string[] {
    return this.children.flatMap((child) => child.render?.(width) ?? []);
  }
}

/**
 * 选择列表组件
 * 渲染一个可选择的列表，当前选中项用 ">" 标记
 */
export class SelectList implements Component {
  constructor(public items: string[] = [], public selected = 0) {}
  render(): string[] {
    return this.items.map((item, index) => `${index === this.selected ? ">" : " "} ${item}`);
  }
}

/**
 * 间距组件
 * 渲染指定数量的空行
 */
export class Spacer implements Component {
  constructor(public size = 1) {}
  render(): string[] {
    return Array.from({ length: this.size }, () => "");
  }
}

/**
 * Markdown 渲染组件
 * 当前实现为简单的按行拆分，不做真正的 Markdown 解析
 */
export class Markdown implements Component {
  constructor(public source = "") {}
  render(): string[] {
    return this.source.split("\n");
  }
}

/** 盒子组件（继承 Container） */
export class Box extends Container {}
