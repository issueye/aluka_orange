/**
 * Aluka Orange 品牌标（方案 C「橙光剖面」，design/logo/variant-c-citrus.svg）
 * 8 瓣橙子剖面 + 中心母品牌棱镜 A；纯矢量内联，随主题与尺寸缩放。
 */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="32" y="32" width="448" height="448" rx="112" fill="#FFF6EA" />
      {/* 果皮环 / 白瓤层 */}
      <circle cx="256" cy="256" r="149" fill="none" stroke="#E8590C" strokeWidth="11" />
      <circle cx="256" cy="256" r="141" fill="#FFFEFA" />
      {/* 8 瓣果肉，深浅交替 */}
      <path d="M260.7,122.1 A134,134 0 0 1 347.4,158.0 L294.2,215.0 A56,56 0 0 0 258.0,200.0 Z" fill="#FFA43B" />
      <path d="M354.0,164.6 A134,134 0 0 1 394.9,251.3 L312.0,254.0 A56,56 0 0 0 297.0,217.8 Z" fill="#F26A1B" />
      <path d="M394.9,260.7 A134,134 0 0 1 354.0,347.4 L297.0,294.2 A56,56 0 0 0 312.0,258.0 Z" fill="#FFA43B" />
      <path d="M347.4,354.0 A134,134 0 0 1 260.7,394.9 L258.0,312.0 A56,56 0 0 0 294.2,297.0 Z" fill="#F26A1B" />
      <path d="M251.3,394.9 A134,134 0 0 1 164.6,354.0 L217.8,297.0 A56,56 0 0 0 254.0,312.0 Z" fill="#FFA43B" />
      <path d="M158.0,347.4 A134,134 0 0 1 121.1,260.7 L200.0,258.0 A56,56 0 0 0 215.0,294.2 Z" fill="#F26A1B" />
      <path d="M121.1,251.3 A134,134 0 0 1 158.0,164.6 L215.0,217.8 A56,56 0 0 0 200.0,254.0 Z" fill="#FFA43B" />
      <path d="M164.6,158.0 A134,134 0 0 1 251.3,122.1 L254.0,200.0 A56,56 0 0 0 217.8,215.0 Z" fill="#F26A1B" />
      {/* 白芯 + 母品牌棱镜 A */}
      <circle cx="256" cy="256" r="54" fill="#FFFEFA" />
      <polygon points="256,234 256,252 234,282 224,282" fill="#FFB35C" />
      <polygon points="256,234 256,252 278,282 288,282" fill="#F2600C" />
      <polygon points="256,234 246,252 266,252" fill="#FFE3B8" />
      <polygon points="256,260 242,276 270,276" fill="#FFFEFA" />
      <polygon points="240,270 272,270 268,276 244,276" fill="#FF8A2A" />
    </svg>
  );
}
