import type { OfficeDeskShape } from "@/organization/office-contracts";

export function PixelPerson({ name, color, avatarUrl }: { name: string; color: string; avatarUrl: string | null }) {
  // Authenticated same-origin images are served only after approval by the office API.
  // eslint-disable-next-line @next/next/no-img-element
  if (avatarUrl) return <img src={avatarUrl} width={32} height={48} alt={`${name}的像素形象`} draggable={false} style={{ imageRendering: "pixelated", width: 32, height: 48, objectFit: "contain" }} />;
  return <svg width="32" height="48" viewBox="0 0 16 24" shapeRendering="crispEdges" aria-hidden="true">
    <ellipse cx="8" cy="22" rx="6" ry="2" fill="#4c423e" opacity=".18" />
    <path d="M4 3h8v2h2v6H2V5h2z" fill="#554339" />
    <path d="M4 6h8v7H4z" fill="#efc295" /><path d="M4 6h3v2H4zm6 0h2v2h-2z" fill="#554339" />
    <path d="M5 9h1v1H5zm5 0h1v1h-1z" fill="#352e35" /><path d="M7 12h2v1H7z" fill="#cf8f75" />
    <path d="M4 13h8v7H4zM2 14h2v4H2zm10 0h2v4h-2z" fill={color} /><path d="M2 18h2v2H2zm10 0h2v2h-2z" fill="#efc295" />
    <path d="M4 20h3v3H4zm5 0h3v3H9z" fill="#414653" /><path d="M3 23h4v1H3zm6 0h4v1H9z" fill="#31333b" />
  </svg>;
}

export function PixelDesk({ color, shape }: { color: string; shape: OfficeDeskShape }) {
  return <svg width="88" height="76" viewBox="0 0 44 38" shapeRendering="crispEdges" aria-hidden="true">
    <path d={shape === "round" ? "M6 16h32v2h4v12h-4v3H6v-3H2V18h4z" : shape === "corner" ? "M2 14h40v20H26V24H2z" : "M2 15h40v16H2z"} fill="#564139" />
    <path d={shape === "round" ? "M8 14h28v2h4v10h-4v3H8v-3H4V16h4z" : shape === "corner" ? "M2 12h40v18H28V22H2z" : "M2 13h40v14H2z"} fill={color} />
    <path d="M4 29h3v8H4zm33 0h3v8h-3z" fill="#554139" />
    <path d="M9 2h20v15H9z" fill="#434c4b" /><path d="M11 4h16v10H11z" fill="#b6d5c1" /><path d="M13 6h10v1H13zm0 3h7v1h-7z" fill="#7d9d91" />
    <path d="M17 17h5v2h4v2H13v-2h4z" fill="#515a55" /><path d="M11 22h17v3H11z" fill="#ded8b8" /><path d="M33 16h4v6h-4z" fill="#ece1ba" /><path d="M34 15h2v2h-2z" fill="#775e48" />
  </svg>;
}

export function PixelPlant() {
  return <svg width="32" height="48" viewBox="0 0 16 24" shapeRendering="crispEdges" aria-hidden="true"><path d="M7 3h3v15H7z" fill="#48754e" /><path d="M2 5h5v3H2zm8-3h4v4h-4zM3 10h5v4H3zm7-2h5v4h-5z" fill="#719560" /><path d="M4 17h9v3H4zm1 3h7v4H5z" fill="#b57d59" /><path d="M5 17h7v2H5z" fill="#674c3d" /></svg>;
}
