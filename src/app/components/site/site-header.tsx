import Link from "next/link";
import { BrandMark } from "./brand-mark";

const NAV = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/fix", label: "Import errors" },
  { href: "/#faq", label: "FAQ" },
];

export function SiteHeader() {
  return (
    <header className="relative z-30 mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
      <Link href="/" className="rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70" aria-label="Home">
        <BrandMark />
      </Link>
      <nav aria-label="Main" className="flex items-center gap-1 text-sm">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="hidden rounded-lg px-3 py-2 text-neutral-400 transition hover:bg-neutral-900 hover:text-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 md:inline-block"
          >
            {item.label}
          </Link>
        ))}
        <Link
          href="/#tool"
          className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
        >
          Clean a CSV
        </Link>
      </nav>
    </header>
  );
}
