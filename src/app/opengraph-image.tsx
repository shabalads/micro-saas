import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "../site/metadata";
import { FREE_ROW_LIMIT } from "./utils/pricing";

export const alt = `${SITE_NAME}: ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Site-wide share image, used by every page that does not have its own. */
export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0a0a0a", padding: 72, color: "#f5f5f5" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 36, fontWeight: 600 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: "linear-gradient(135deg,#34d399,#059669)", display: "flex", alignItems: "center", justifyContent: "center", color: "#0a0a0a" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="#0a0a0a" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          {SITE_NAME}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1.05, display: "flex" }}>Stop fixing supplier CSVs by hand.</div>
          <div style={{ fontSize: 34, color: "#a3a3a3", display: "flex" }}>Cleaned in your browser. Free up to {FREE_ROW_LIMIT} rows.</div>
        </div>
        <div style={{ height: 8, width: "100%", borderRadius: 4, background: "linear-gradient(90deg,#34d399,#2dd4bf,#6366f1)", display: "flex" }} />
      </div>
    ),
    size,
  );
}
