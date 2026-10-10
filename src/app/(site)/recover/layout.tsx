// src/app/recover/layout.tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Recover your file",
  description: "Paid for a cleaned file and lost the download? Get it back with your Stripe receipt email or session id.",
  // A utility page for existing customers: keep it out of search results.
  robots: { index: false, follow: false },
};

export default function RecoverLayout({ children }: { children: ReactNode }) {
  return children;
}
