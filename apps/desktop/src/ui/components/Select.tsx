import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { Field } from "./Field.tsx";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SelectProps = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  label?: string;
  hint?: string;
  className?: string;
  /** 下拉列表最大高度 */
  maxMenuHeight?: number;
};

type MenuStyle = {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "bottom" | "top";
};

function buildMenuStyle(
  trigger: HTMLElement,
  maxMenuHeight: number,
  measuredHeight?: number,
): MenuStyle {
  const rect = trigger.getBoundingClientRect();
  const gap = 6;
  const pad = 8;
  const spaceBelow = window.innerHeight - rect.bottom - pad;
  const spaceAbove = rect.top - pad;
  const preferBottom = spaceBelow >= Math.min(120, maxMenuHeight) || spaceBelow >= spaceAbove;
  const available = preferBottom ? spaceBelow : spaceAbove;
  const maxHeight = Math.max(72, Math.min(maxMenuHeight, available - gap));

  let width = Math.max(rect.width, 160);
  let left = rect.left;
  if (left + width > window.innerWidth - pad) {
    left = Math.max(pad, window.innerWidth - width - pad);
  }
  if (left < pad) left = pad;

  if (preferBottom) {
    return {
      top: rect.bottom + gap,
      left,
      width,
      maxHeight,
      placement: "bottom",
    };
  }

  // 向上展开：用 bottom 锚定触发器上沿，避免按 maxHeight 虚高导致菜单悬空
  const style: MenuStyle = {
    bottom: window.innerHeight - rect.top + gap,
    left,
    width,
    maxHeight,
    placement: "top",
  };

  if (measuredHeight && measuredHeight > 0) {
    const top = rect.top - gap - Math.min(measuredHeight, maxHeight);
    if (top >= pad) {
      return {
        top,
        left,
        width,
        maxHeight,
        placement: "top",
      };
    }
  }

  return style;
}

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
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<MenuStyle | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const listId = useId();
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
      setMenuStyle(buildMenuStyle(triggerRef.current, maxMenuHeight, measured));
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
              width: menuStyle.width,
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
                      onClick={() => {
                        if (opt.disabled) return;
                        onChange(opt.value);
                        setOpen(false);
                      }}
                    >
                      <span>{opt.label}</span>
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
