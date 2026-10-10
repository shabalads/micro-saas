"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { type RefundState, refundPurchaseAction } from "./actions";

/** How often the page re-reads the purchase while a refund is waiting for Stripe's webhook, and for how long. */
const POLL_MS = 3000;
const POLL_TIMES = 20;

/**
 * The Refund button on a paid purchase. It never refunds on its own: the first click only asks "are you sure?", and the
 * money moves when the second, explicit click submits the form. Afterwards the page keeps re-reading the purchase until the
 * charge.refunded webhook has marked it refunded.
 */
export function RefundControl({ sessionId, email, waiting }: { sessionId: string; email: string; waiting: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<RefundState, FormData>(refundPurchaseAction, { status: "idle", message: null });
  const requested = state.status === "requested" || waiting;

  useEffect(() => {
    if (!requested) return;
    let times = 0;
    const timer = setInterval(() => {
      router.refresh();
      if (++times >= POLL_TIMES) clearInterval(timer);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [requested, router]);

  if (requested) {
    return (
      <div className="space-y-1 text-xs">
        <p className="text-amber-300" role="status">
          Refund requested, waiting for Stripe&hellip;
        </p>
        {state.message && <p className="max-w-xs text-neutral-500">{state.message}</p>}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-1.5">
      <input type="hidden" name="sessionId" value={sessionId} />
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-lg border border-neutral-700 px-3 py-1 text-xs font-medium text-neutral-200 transition hover:border-rose-500/60 hover:text-rose-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60"
        >
          Refund
        </button>
      ) : (
        <div className="space-y-1.5" role="group" aria-label={`Confirm refund to ${email}`}>
          <p className="max-w-xs text-xs text-neutral-300">
            Refund the full payment to <strong>{email}</strong>? This cannot be undone, and it locks their file again.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={pending}
              aria-busy={pending}
              className="rounded-lg bg-rose-500 px-3 py-1 text-xs font-semibold text-neutral-950 transition hover:bg-rose-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:cursor-wait disabled:opacity-70"
            >
              {pending ? "Refunding…" : "Yes, refund"}
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="rounded-lg px-2 py-1 text-xs text-neutral-400 transition hover:text-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60">
              Cancel
            </button>
          </div>
        </div>
      )}
      {state.status === "error" && state.message && (
        <p role="alert" className="max-w-xs text-xs text-rose-300">
          {state.message}
        </p>
      )}
    </form>
  );
}
