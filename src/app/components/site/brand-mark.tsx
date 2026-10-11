import { COMPANY } from "../../../site/company";

export function BrandMark() {
  const [first, ...rest] = COMPANY.brandName.split(" ");
  const last = rest.pop();
  return (
    <span className="flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-neutral-950 shadow-lg shadow-emerald-500/20">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
          <path d="m5 12 4.5 4.5L19 7" />
        </svg>
      </span>
      <span className="text-sm font-semibold leading-tight tracking-tight text-neutral-50 sm:text-base sm:leading-normal">
        {[first, ...rest].join(" ")} {last && <span className="text-emerald-400">{last}</span>}
      </span>
    </span>
  );
}
