/**
 * 图片灯箱预览：全屏遮罩 + 居中大图。
 * 用于 Markdown 内嵌图片与聊天图片附件的放大查看。
 * 点击遮罩 / ESC 关闭；点击图片在「适应窗口 / 1:1 原始尺寸」间切换。
 */
import { useEffect, useState } from "react";
import { X, ZoomIn, ZoomOut } from "lucide-react";

export type ImageViewerProps = {
  src: string;
  alt?: string;
  onClose: () => void;
};

export function ImageViewer(props: ImageViewerProps) {
  const [actual, setActual] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  return (
    <div
      className="ui-lightbox"
      data-aluka-drag="no-drag"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <button type="button" className="ui-lightbox__close" title="关闭 (Esc)" onClick={props.onClose}>
        <X size={18} />
      </button>
      <div className="ui-lightbox__stage">
        <img
          src={props.src}
          alt={props.alt ?? ""}
          className={actual ? "is-actual" : ""}
          onClick={() => setActual((v) => !v)}
        />
      </div>
      <div className="ui-lightbox__hint">
        {actual ? <ZoomOut size={13} /> : <ZoomIn size={13} />}
        <span>{actual ? "点击缩小适应窗口" : "点击查看原始尺寸"} · Esc 关闭</span>
      </div>
    </div>
  );
}
