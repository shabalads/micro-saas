// src/app/(site)/recover/page.tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";
import type { PurchaseGrant } from "../../types/unlock";
import { rememberPurchases } from "../../utils/entitlements";
import { requestUnlock } from "../../utils/unlock-client";

type Phase =
  | { name: "idle" }
  | { name: "loading" }
  | { name: "found"; purchases: PurchaseGrant[] }
  | { name: "problem"; message: string };

const SESSION_ID_RE = /^cs_(test|live)_/i;

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Get a payment back on any device. The server looks the payment up (by the Stripe session id, or by the email on the
 * Stripe receipt) and the result is remembered here. A payment unlocks the exact file it was made for, so afterwards
 * the customer uploads that same file on the home page and its complete download unlocks, with no second payment.
 */
export default function RecoverPage() {
  const [value, setValue] = useState("");
  const [phase, setPhase] = useState<Phase>({ name: "idle" });

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = value.trim();
    if (input === "" || phase.name === "loading") return;

    setPhase({ name: "loading" });
    const result = await requestUnlock(SESSION_ID_RE.test(input) ? { sessionId: input } : { email: input });

    if (result.status === "paid") {
      rememberPurchases(result.purchases);
      setPhase({ name: "found", purchases: result.purchases });
    } else if (result.status === "pending") {
      setPhase({ name: "problem", message: "Stripe hasn't confirmed that payment yet. Try again in a minute." });
    } else if (result.status === "refunded") {
      setPhase({ name: "problem", message: `${result.message} If that's unexpected, contact us and mention the email on your receipt.` });
    } else if (result.status === "not_found") {
      setPhase({
        name: "problem",
        message: "We couldn't find a paid purchase for that. Check the email on your Stripe receipt, or paste the session id (it starts with cs_).",
      });
    } else {
      setPhase({ name: "problem", message: result.message });
    }
  };

  return (
    <>
      <div className="mx-auto w-full max-w-xl px-4 pb-24 pt-10 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-50">Recover your file</h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-400">
          Paid for a cleaned file but lost the download, or you&rsquo;re on a different device? Enter the email address from
          your Stripe receipt, or the Stripe session id (it starts with <span className="text-neutral-300">cs_</span>).
        </p>

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-3">
          <label htmlFor="recover-input" className="text-xs font-medium text-neutral-400">
            Receipt email or session id
          </label>
          <input
            id="recover-input"
            name="recover"
            type="text"
            required
            autoComplete="email"
            spellCheck={false}
            maxLength={300}
            placeholder="you@yourstore.com or cs_live_..."
            value={value}
            disabled={phase.name === "loading"}
            onChange={(event) => setValue(event.target.value)}
            className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-neutral-50 placeholder:text-neutral-600 transition focus:border-emerald-500/70 focus:outline-none focus:ring-2 focus:ring-emerald-400/40 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={phase.name === "loading"}
            aria-busy={phase.name === "loading"}
            className="rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-neutral-950 shadow-lg shadow-emerald-500/25 ring-1 ring-emerald-300/30 transition hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-wait disabled:opacity-80 disabled:hover:bg-emerald-500"
          >
            {phase.name === "loading" ? "Looking it up…" : "Find my payment"}
          </button>
        </form>

        {phase.name === "problem" && (
          <p role="alert" className="mt-6 animate-fade-up rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100 motion-reduce:animate-none">
            {phase.message}
          </p>
        )}

        {phase.name === "found" && (
          <div role="status" className="mt-6 animate-fade-up space-y-4 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-100 motion-reduce:animate-none">
            <p className="font-semibold">
              {phase.purchases.length === 1 ? "We found your payment." : `We found ${phase.purchases.length} payments.`} It is now unlocked on this device.
            </p>
            <ul className="space-y-1 text-emerald-100/80">
              {phase.purchases.map((purchase) => (
                <li key={purchase.sessionId}>
                  Reference <span className="font-mono">{purchase.sessionRef}</span>
                  {formatDate(purchase.paidAt) && <> &middot; paid {formatDate(purchase.paidAt)}</>}
                </li>
              ))}
            </ul>
            <p>
              Now upload <strong>the same file</strong> you paid for on the home page. Its complete cleaned download will unlock
              automatically. A payment covers the one file it was made for.
            </p>
            <Link
              href="/"
              className="inline-block rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
            >
              Go to the app
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
