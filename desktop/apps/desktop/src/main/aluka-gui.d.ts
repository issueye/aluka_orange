/**
 * aluka:gui 模块类型声明
 *
 * 对应 Go 运行时（aluka_lang）注入的原生 GUI 模块；按主进程实际用到的
 * API 面声明，未覆盖的能力以运行时为准（internal/runtime/globals/aluka_gui.go）。
 */

declare module "aluka:gui" {
  export type GuiWindowOptions = {
    title?: string;
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    center?: boolean;
    frame?: boolean;
    devTools?: boolean;
    url: string;
  };

  export type GuiWindow = {
    /** 向渲染进程推送事件（bridge events 总线的对端） */
    emit: (name: string, data?: unknown) => void;
    on: (name: string, handler: (data: unknown) => void) => void;
    show: () => void;
    hide: () => void;
  };

  export const app: {
    /** 注册渲染进程可调用的 RPC（params 类型由调用方约定，运行时不校验） */
    registerRPC: (name: string, handler: (params: any) => unknown) => void;
    unregisterRPC: (name: string) => void;
    quit: () => void;
    run: () => void;
  };

  export function createWindow(opts: GuiWindowOptions): GuiWindow;

  export function createTray(opts: {
    tooltip?: string;
    icon?: string;
    menu: Array<{ label?: string; type?: string; click?: () => void }>;
  }): { on: (event: string, handler: () => void) => void; destroy: () => void };

  export function setAssetDir(dir: string): void;

  export const globalShortcut: {
    register: (accelerator: string, handler: () => void) => void;
    unregisterAll: () => void;
  };

  export const shell: {
    /** 在系统文件管理器中显示并定位文件/文件夹 */
    showItemInFolder: (fullPath: string) => void;
  };
}
