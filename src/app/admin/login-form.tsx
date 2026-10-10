"use client";

import { useActionState } from "react";
import { type LoginState, loginAction } from "./actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, { error: null });
  return (
    <form action={formAction} className="mx-auto mt-16 flex w-full max-w-sm flex-col gap-3">
      <label htmlFor="admin-password" className="text-xs font-medium text-neutral-400">Admin password</label>
      <input
        id="admin-password"
        name="password"
        type="password"
        required
        autoComplete="current-password"
        autoFocus
        className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-neutral-50 focus:border-emerald-500/70 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
      />
      {state.error && <p role="alert" className="text-xs text-rose-300">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-wait disabled:opacity-80"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
