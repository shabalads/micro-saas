import Link from "next/link";
import { COMPANY } from "../../../site/company";
import { Fill } from "./fill";

const COLUMNS: Array<{ heading: string; links: Array<{ href: string; label: string }> }> = [
  {
    heading: "Product",
    links: [
      { href: "/#how-it-works", label: "How it works" },
      { href: "/#pricing", label: "Pricing" },
      { href: "/#faq", label: "FAQ" },
      { href: "/fix", label: "Shopify import errors" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/privacy", label: "Privacy policy" },
      { href: "/terms", label: "Terms of service" },
      { href: "/refunds", label: "Refund policy" },
    ],
  },
  {
    heading: "Help",
    links: [
      { href: "/contact", label: "Contact" },
      { href: "/recover", label: "Recover a purchase" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative border-t border-neutral-900 bg-neutral-950/80">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)] lg:px-8">
        <div className="max-w-sm space-y-3 text-sm text-neutral-500">
          <p className="text-base font-semibold text-neutral-200">{COMPANY.brandName}</p>
          <p>Your files are processed entirely in your browser and never leave your device. Only anonymous counts (rows, timings, file size) are logged, never your data.</p>
        </div>
        {COLUMNS.map((column) => (
          <nav key={column.heading} aria-label={column.heading}>
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">{column.heading}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-neutral-500 transition hover:text-emerald-300 focus:outline-none focus-visible:underline">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-neutral-900">
        <p className="mx-auto max-w-7xl px-4 py-5 text-xs leading-relaxed text-neutral-600 sm:px-6 lg:px-8">
          &copy; <Fill value={COMPANY.legalName} />, company ID <Fill value={COMPANY.companyId} />,{" "}
          <Fill value={COMPANY.street} />, <Fill value={COMPANY.postalCode} /> <Fill value={COMPANY.city} />, {COMPANY.country}.
        </p>
      </div>
    </footer>
  );
}
