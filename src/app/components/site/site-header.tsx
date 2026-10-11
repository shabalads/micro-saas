"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "./brand-mark";
import { useSmartHeader } from "./use-smart-header";

const NAV = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/fix", label: "Import errors" },
  { href: "/#faq", label: "FAQ" },
];

const MENU_ID = "site-mobile-menu";
/** Tailwind's md breakpoint: from here on the links sit in the bar and the menu button is gone. */
const DESKTOP = "(min-width: 768px)";

/**
 * Sticky header that slides away while the page is read downward and comes back at the first scroll up (see
 * useSmartHeader). It stays in normal flow and only moves with a transform, so the page below never shifts.
 */
export function SiteHeader() {
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { hidden, scrolled } = useSmartHeader(headerRef, menuOpen);

  // While the menu is open: Escape and a tap outside close it, and so does growing the window to the desktop layout
  // (where the menu is not shown, so it must not keep pinning the header).
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const desktop = window.matchMedia(DESKTOP);
    const onResize = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    desktop.addEventListener("change", onResize);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      desktop.removeEventListener("change", onResize);
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header
      ref={headerRef}
      data-site-header=""
      data-state={hidden ? "hidden" : "visible"}
      style={{ transform: hidden ? "translateY(-100%)" : "translateY(0)" }}
      className={`sticky top-0 z-40 w-full border-b bg-neutral-950/70 backdrop-blur-md transition-[transform,border-color] duration-200 ease-out motion-reduce:transition-none ${
        scrolled ? "border-neutral-800/80" : "border-transparent"
      }`}
    >
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-2 px-4 py-3 sm:gap-4 sm:px-6 sm:py-4 lg:px-8">
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
            className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 min-[360px]:whitespace-nowrap"
          >
            Clean a CSV
          </Link>
          <button
            ref={menuButtonRef}
            type="button"
            aria-expanded={menuOpen}
            aria-controls={MENU_ID}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((open) => !open)}
            className="ml-1 inline-flex h-10 w-10 items-center justify-center rounded-xl text-neutral-300 transition hover:bg-neutral-900 hover:text-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 md:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
              {menuOpen ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </nav>
      </div>

      <div
        id={MENU_ID}
        className={`${menuOpen ? "block" : "hidden"} absolute inset-x-0 top-full border-b border-neutral-800/80 bg-neutral-950 md:hidden`}
      >
        <nav aria-label="Mobile menu" className="mx-auto flex max-w-7xl flex-col px-3 py-2 sm:px-5">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={closeMenu}
              className="rounded-lg px-3 py-3 text-base text-neutral-300 transition hover:bg-neutral-900 hover:text-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
