import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { Field } from "./Field.tsx";

/** 下拉选项类型 */
export type SelectOption = {
  /** 选项值 */
  value: string;
  /** 显示文本 */
  label: string;
  /** 是否禁用 */
  disabled?: boolean;
};

/**
 * Select 下拉选择器属性类型
 * 基于 Portal 实现的自定义下拉组件，替代原生 <select>。
 */
export type SelectProps = {
  /** 当前选中值（受控模式） */
  value: string;
  /** 可选选项列表 */
  options: SelectOption[];
  /** 值变更回调 */
  onChange: (value: string) => void;
  /** 未选中时的占位文本 */
  placeholder?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 字段标签 */
  label?: string;
  /** 说明提示文字 */
  hint?: string;
  /** 额外 CSS 类名 */
  className?: string;
  /** 下拉列表最大高度（默认 260px） */
  maxMenuHeight?: number;
};

/** 下拉菜单定位样式 */
type MenuStyle = {
  top?: number;
  bottom?: number;
  left: number;
  minWidth: number;
  maxWidth: number;
  maxHeight: number;
  placement: "bottom" | "top";
};

/** 菜单宽度上限：内容可撑开菜单，但不超过该值（同时受视口约束） */
const MENU_MAX_WIDTH = 420;

/**
 * 计算下拉菜单的定位样式
 * 根据触发器位置自动决定向上或向下展开，并限制最大高度。
 * 宽度策略：至少与触发器对齐，长文本按内容撑开（CSS max-content），上限 MENU_MAX_WIDTH。
 */
function buildMenuStyle(
  trigger: HTMLElement,
  maxMenuHeight: number,
  measuredHeight?: number,
  measuredWidth?: number,
): MenuStyle {
  const rect = trigger.getBoundingClientRect();
  const gap = 6;
  const pad = 8;
  const spaceBelow = window.innerHeight - rect.bottom - pad;
  const spaceAbove = rect.top - pad;
  const preferBottom = spaceBelow >= Math.min(120, maxMenuHeight) || spaceBelow >= spaceAbove;
  const available = preferBottom ? spaceBelow : spaceAbove;
  const maxHeight = Math.max(72, Math.min(maxMenuHeight, available - gap));

  const minWidth = rect.width;
  const maxWidth = Math.max(minWidth, Math.min(MENU_MAX_WIDTH, window.innerWidth - pad * 2));

  let left = rect.left;
  // 菜单按内容撑开后，把右缘收进视口；未量到宽度时先按上限兜底
  const assumedWidth = measuredWidth && measuredWidth > 0 ? measuredWidth : maxWidth;
  if (left + assumedWidth > window.innerWidth - pad) {
    left = Math.max(pad, window.innerWidth - assumedWidth - pad);
  }
  if (left < pad) left = pad;

  if (preferBottom) {
    return {
      top: rect.bottom + gap,
      left,
      minWidth,
      maxWidth,
      maxHeight,
      placement: "bottom",
    };
  }

  // 向上展开：用 bottom 锚定触发器上沿，避免按 maxHeight 虚高导致菜单悬空
  const style: MenuStyle = {
    bottom: window.innerHeight - rect.top + gap,
    left,
    minWidth,
    maxWidth,
    maxHeight,
    placement: "top",
  };

  if (measuredHeight && measuredHeight > 0) {
    const top = rect.top - gap - Math.min(measuredHeight, maxHeight);
    if (top >= pad) {
      return {
        top,
        left,
        minWidth,
        maxWidth,
        maxHeight,
        placement: "top",
      };
    }
  }

  return style;
}

/**
 * 自定义下拉选择器组件
 * 使用 Portal 渲染下拉菜单，自动计算展开方向和最大高度。
 * 支持键盘导航和无障碍访问。
 */
export function Select({
  value,
  options,
  onChange,
  placeholder = "请选择",
  disabled = false,
  label,
  hint,
  className = "",
  maxMenuHeight = 260,
}: SelectProps) {
  const [open, setOpen] = useState(false); // 下拉菜单是否展开
  const [menuStyle, setMenuStyle] = useState<MenuStyle | null>(null); // 菜单定位样式
  const rootRef = useRef<HTMLDivElement>(null); // 根容器引用
  const triggerRef = useRef<HTMLButtonElement>(null); // 触发按钮引用
  const menuRef = useRef<HTMLUListElement>(null); // 下拉菜单引用
  const listId = useId(); // 用于 aria 关联的唯一 ID
  // 根据当前 value 查找选中项
  const selected = useMemo(
    () => options.find((opt) => opt.value === value),
    [options, value],
  );

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setMenuStyle(null);
      return;
    }

    const update = () => {
      if (!triggerRef.current) return;
      const measured = menuRef.current?.offsetHeight;
      const measuredWidth = menuRef.current?.offsetWidth;
      setMenuStyle(buildMenuStyle(triggerRef.current, maxMenuHeight, measured, measuredWidth));
    };

    update();
    // 下一帧再量一次真实高度，收紧向上展开位置
    const raf = requestAnimationFrame(update);

    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, maxMenuHeight, options.length, value]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const menu =
    open && menuStyle
      ? createPortal(
          <ul
            ref={menuRef}
            id={listId}
            className={[
              "ui-select__menu",
              "ui-select__menu--portal",
              menuStyle.placement === "top" ? "is-top" : "is-bottom",
            ].join(" ")}
            role="listbox"
            style={{
              top: menuStyle.top,
              bottom: menuStyle.bottom,
              left: menuStyle.left,
              minWidth: menuStyle.minWidth,
              maxWidth: menuStyle.maxWidth,
              maxHeight: menuStyle.maxHeight,
            }}
          >
            {options.length === 0 ? (
              <li className="ui-select__empty">暂无选项</li>
            ) : (
              options.map((opt) => {
                const active = opt.value === value;
                return (
                  <li key={opt.value} role="option" aria-selected={active}>
                    <button
                      type="button"
                      className={["ui-select__option", active ? "is-active" : ""].filter(Boolean).join(" ")}
                      disabled={opt.disabled}
                      title={opt.label}
                      onClick={() => {
                        if (opt.disabled) return;
                        onChange(opt.value);
                        setOpen(false);
                      }}
                    >
                      <span className="ui-select__option-label">{opt.label}</span>
                      {active ? <Check size={14} /> : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>,
          document.body,
        )
      : null;

  const control = (
    <div
      ref={rootRef}
      className={["ui-select", open ? "is-open" : "", disabled ? "is-disabled" : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        ref={triggerRef}
        type="button"
        className="ui-select__trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
      >
        <span className={selected ? "ui-select__value" : "ui-select__placeholder"}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown size={14} className="ui-select__chevron" />
      </button>
      {menu}
    </div>
  );

  if (!label && !hint) return control;

  return (
    <Field label={label} hint={hint}>
      {control}
    </Field>
  );
}
