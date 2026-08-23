/**
 * 壳层槽位渲染器（SlotOutlet）
 *
 * 每个槽位渲染「内置内容（builtin）」+「插件 v2 贡献（按 when 求值与 order 排序）」。
 * - T0 模板：宿主按白名单模板渲染，插件只出元数据（badge/link/button/card/compact-row）；
 * - 组件档（uiModule）：R5 内部 SSR 生效前先渲染占位提示，不占空位。
 * 槽位清单与规范见 @aluka/shell-contracts 与 desktop/docs/external-plugin-spec.md。
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  SHELL_SLOT_TEMPLATES,
  isSlotDataList,
  type ShellSlot,
  type ShellSlotTemplate,
  type SlotData,
  type UiContribution,
  type UiContributionV2,
} from "@aluka/shell-contracts";
import { rpc } from "../bridge.ts";
import { PluginScan } from "./plugin-scan.tsx";
import { useShell } from "./store.ts";
import { evalWhen } from "./context-keys.ts";

/** 槽位贡献排序：内置 0-999，插件默认 1000+ */
function sortOrder(contribution: UiContributionV2): number {
  return typeof contribution.order === "number" ? contribution.order : 1000;
}

/** 模板推断：显式 template 优先；缺省按字段形状（url→link，command→button，否则 card） */
function inferTemplate(contribution: UiContributionV2): ShellSlotTemplate {
  if (contribution.template && SHELL_SLOT_TEMPLATES.includes(contribution.template)) {
    return contribution.template;
  }
  if (contribution.url) return "link";
  if (contribution.command) return "button";
  return "card";
}

/** 把 /command 预填到对话输入框并切回对话视图（与 PluginPanel 同机制） */
function runCommand(command: string): void {
  window.dispatchEvent(
    new CustomEvent("aluka:prompt-insert", { detail: { text: `/${command} ` } }),
  );
}

function BadgeTemplate({ contribution }: { contribution: UiContributionV2 }) {
  return (
    <span className="aluka-plugin-item aluka-plugin-badge" title={contribution.description}>
      {contribution.title}
    </span>
  );
}

function LinkTemplate({ contribution }: { contribution: UiContributionV2 }) {
  return (
    <a
      className="aluka-plugin-item aluka-plugin-link"
      href={contribution.url ?? "#"}
      target="_blank"
      rel="noreferrer"
      title={contribution.description}
    >
      {contribution.title}
    </a>
  );
}

function ButtonTemplate({ contribution }: { contribution: UiContributionV2 }) {
  if (!contribution.command) return <CardTemplate contribution={contribution} />;
  return (
    <button
      type="button"
      className="aluka-plugin-item aluka-plugin-button"
      title={contribution.description}
      onClick={() => runCommand(contribution.command!)}
    >
      <span>{contribution.title}</span>
      <small>/{contribution.command}</small>
    </button>
  );
}

function CardTemplate({ contribution }: { contribution: UiContributionV2 }) {
  return (
    <div className="aluka-plugin-item aluka-plugin-card">
      <div className="aluka-plugin-card__title">{contribution.title}</div>
      {contribution.description ? (
        <div className="aluka-plugin-card__desc">{contribution.description}</div>
      ) : null}
      {(contribution.command || contribution.url) ? (
        <div className="aluka-plugin-card__actions">
          {contribution.command ? (
            <button type="button" onClick={() => runCommand(contribution.command!)}>
              运行 /{contribution.command}
            </button>
          ) : null}
          {contribution.url ? (
            <a href={contribution.url} target="_blank" rel="noreferrer">
              打开链接
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CompactRowTemplate({ contribution }: { contribution: UiContributionV2 }) {
  return (
    <div className="aluka-plugin-item aluka-plugin-compact-row" title={contribution.description}>
      <span>{contribution.title}</span>
      <small>{contribution.description}</small>
    </div>
  );
}

const TEMPLATE_RENDERERS: Record<ShellSlotTemplate, (props: { contribution: UiContributionV2 }) => ReactNode> = {
  badge: BadgeTemplate,
  link: LinkTemplate,
  button: ButtonTemplate,
  card: CardTemplate,
  "compact-row": CompactRowTemplate,
};

/** 数据模板徽章：渲染时拉取 getSlotData，3s 轮询；异常/缺失回退静态元数据标题 */
function SlotDataBadge({ contribution }: { contribution: UiContributionV2 }) {
  const [data, setData] = useState<SlotData | undefined>();
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const result = await rpc<{ ok: boolean; data?: SlotData }>("getSlotData", {
          slot: contribution.slot,
          contributionId: contribution.id,
        });
        if (mounted && result?.data) setData(result.data);
      } catch {
        /* 回退静态元数据标题 */
      }
    };
    void load();
    const timer = window.setInterval(load, 3000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [contribution.id, contribution.slot]);
  return (
    <span
      className={`aluka-plugin-item aluka-plugin-badge${data && !isSlotDataList(data) && data.kind ? ` is-${data.kind}` : ""}`}
      title={contribution.description ?? contribution.title}
    >
      {data && !isSlotDataList(data) ? data.text : contribution.title}
    </span>
  );
}

/** 数据卡片：列表形态数据渲染为组件卡，非列表回退静态 CardTemplate */
function SlotDataCard({ contribution }: { contribution: UiContributionV2 }) {
  const [data, setData] = useState<SlotData | undefined>();
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const result = await rpc<{ ok: boolean; data?: SlotData }>("getSlotData", {
          slot: contribution.slot,
          contributionId: contribution.id,
        });
        if (mounted && result?.data) setData(result.data);
      } catch {
        /* 回退静态模板 */
      }
    };
    void load();
    const timer = window.setInterval(load, 3000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [contribution.id, contribution.slot]);
  if (data && isSlotDataList(data)) {
    return (
      <div className="aluka-plugin-item aluka-plugin-todo">
        <div className="aluka-plugin-todo__head">
          <span className="aluka-plugin-todo__title">{data.summary ?? contribution.title}</span>
          <button
            type="button"
            className="aluka-plugin-todo__action"
            onClick={() => runCommand("todo add")}
          >
            /todo add
          </button>
        </div>
        {data.items.length ? (
          <ul className="aluka-plugin-todo__list">
            {data.items.map((item, index) => (
              <li
                key={index}
                className={`aluka-plugin-todo__item is-${item.state ?? "pending"}`}
              >
                <span className="aluka-plugin-todo__state" aria-hidden="true">
                  {item.state === "done" ? "✓" : item.state === "error" ? "!" : "○"}
                </span>
                <span className="aluka-plugin-todo__text">{item.title}</span>
                {item.desc ? <small className="aluka-plugin-todo__desc">{item.desc}</small> : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="aluka-plugin-todo__empty">{data.empty ?? "暂无待办"}</div>
        )}
      </div>
    );
  }
  return <CardTemplate contribution={contribution} />;
}

/** 单条插件贡献（v2）渲染；组件档（uiModule）经 PluginScan 渲染内部 SSR 片段，失败回退 T0 数据卡 */
function ContributionRenderer({ contribution }: { contribution: UiContributionV2 }) {
  if (contribution.uiModule) {
    return (
      <PluginScan
        contribution={contribution}
        fallback={<SlotDataCard contribution={contribution} />}
      />
    );
  }
  const template = inferTemplate(contribution);
  if (contribution.slot === "statusbar" || template === "badge") {
    return <SlotDataBadge contribution={contribution} />;
  }
  if (template === "card") {
    return <SlotDataCard contribution={contribution} />;
  }
  const renderer = TEMPLATE_RENDERERS[template];
  return renderer({ contribution });
}

/**
 * 槽位渲染器：builtin 可空（如 sidebar.top 尚无内置内容），
 * 插件贡献经 when 求值 + order 排序后追加在 builtin 之后。
 */
export function SlotOutlet(props: { slot: ShellSlot; builtin?: ReactNode; className?: string }) {
  const contributions = useShell((s) => s.uiContributions).filter(
    (c): c is UiContributionV2 => c.version === 2 && c.slot === props.slot,
  );
  const disabled = useShell((s) => s.disabledContributions);
  const visible = contributions
    .filter((c) => evalWhen(c.when) && !disabled.includes(c.id))
    .sort((a, b) => sortOrder(a) - sortOrder(b));
  const className = `slot slot--${props.slot}${props.className ? ` ${props.className}` : ""}`;
  return (
    <div className={className}>
      {props.builtin}
      {visible.map((c) => (
        <ContributionRenderer key={c.id} contribution={c} />
      ))}
    </div>
  );
}

/** 判断贡献类型是否为 v2 槽位贡献（供 chrome 区段使用） */
export function isSlotContribution(
  c: UiContribution,
  slot: ShellSlot,
): c is UiContributionV2 {
  return c.version === 2 && c.slot === slot;
}
