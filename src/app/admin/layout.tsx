import type { Metadata } from "next";
import type { ReactNode } from "react";

// Never indexed, never in the sitemap, and disallowed in robots.txt.
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false, nocache: true } };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-neutral-950 font-mono text-neutral-100">{children}</div>;
}
