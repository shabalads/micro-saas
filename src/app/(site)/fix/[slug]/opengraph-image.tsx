import { ImageResponse } from "next/og";
import { getGuide } from "../../../../site/import-errors";
import { SITE_NAME } from "../../../../site/metadata";
import { FREE_ROW_LIMIT } from "../../../utils/pricing";

export const alt = "Shopify import error guide";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** One share image per guide, with the guide's own heading. Rendered on first request, then served from cache (the URL carries a content hash). */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = getGuide(slug);
  const title = guide?.title ?? "Shopify import errors";

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0a0a0a", padding: 72, color: "#f5f5f5" }}>
        <div style={{ display: "flex", fontSize: 30, color: "#34d399", fontWeight: 600 }}>Shopify import errors</div>
        <div style={{ display: "flex", fontSize: title.length > 48 ? 66 : 78, fontWeight: 700, lineHeight: 1.1 }}>{title}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", fontSize: 30, color: "#a3a3a3" }}>{SITE_NAME}: free up to {FREE_ROW_LIMIT} rows, processed in your browser</div>
          <div style={{ height: 8, width: "100%", borderRadius: 4, background: "linear-gradient(90deg,#34d399,#2dd4bf,#6366f1)", display: "flex" }} />
        </div>
      </div>
    ),
    size,
  );
}
