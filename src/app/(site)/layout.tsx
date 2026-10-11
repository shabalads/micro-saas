import type { ReactNode } from "react";
import { SiteFooter } from "../components/site/site-footer";
import { SiteHeader } from "../components/site/site-header";

/**
 * Shared frame for every public page: dark background, header and footer. The admin area does not use it.
 * overflow-x-clip, not -hidden: hidden would turn this wrapper into a scroll container, and a sticky header only sticks
 * to the nearest one (it would never leave the top of the wrapper). clip cuts off the same overflow without that.
 * The site-frame class scopes the scroll-margin rule in globals.css to these pages.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="site-frame relative flex min-h-screen flex-col overflow-x-clip bg-neutral-950 font-mono text-neutral-100">
      {/* The brand line sits above the header (z-40) so the translucent bar does not dim it at the top of the page. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-50">
        <div className="h-0.5 bg-gradient-to-r from-emerald-400 via-teal-400 to-indigo-500" />
        <div className="h-3 bg-gradient-to-r from-emerald-400/30 via-teal-400/20 to-indigo-500/30 blur-md" />
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(70%_60%_at_50%_0%,rgba(16,185,129,0.14),transparent)]"
      />
      <SiteHeader />
      <main className="relative flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
