// src/app/components/export-options.tsx

import { useState } from "react";
import type { SanitizeOptions, TitleCasing } from "../types/csv";

const CASING_CHOICES: ReadonlyArray<{ value: TitleCasing; label: string }> = [
  { value: "title", label: "Title Case" },
  { value: "sentence", label: "Sentence case" },
  { value: "keep", label: "Keep as supplied" },
];

const CASING_HINT: Record<TitleCasing, string> = {
  title: "ALL CAPS and all-lowercase titles become Title Case. Titles that are already mixed case are left alone.",
  sentence: "Only the first letter, acronyms, tokens with digits (750ml, USB-C) and words that already had capitals (iPhone) keep their capitals.",
  keep: "Titles and vendors are written exactly as your supplier typed them (spaces and markup are still tidied).",
};

/** The markup in percent, typed freely (it may be empty for a moment) and committed when it is a number from 0 up. */
function MarkupInput({ value, onCommit }: { value: number; onCommit: (percent: number) => void }) {
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-1.5">
      <label htmlFor="option-markup" className="text-xs text-neutral-400">
        Markup
      </label>
      <input
        id="option-markup"
        type="number"
        inputMode="decimal"
        min={0}
        max={10000}
        step="any"
        value={typed ?? String(value)}
        onChange={(event) => {
          setTyped(event.target.value);
          const percent = Number(event.target.value);
          if (event.target.value.trim() !== "" && Number.isFinite(percent) && percent >= 0) onCommit(percent);
        }}
        onBlur={() => setTyped(null)}
        className="w-20 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-200 focus:border-emerald-500/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
      />
      <span className="text-xs text-neutral-400">%</span>
    </span>
  );
}

/**
 * The switches and the casing choice that change the file that is written. They apply to the preview below straight
 * away and to the download, and the Stripe round trip keeps them.
 */
export default function ExportOptions({
  options,
  skusShared,
  samples,
  onChange,
}: {
  options: SanitizeOptions;
  /** True when the variants of some product in the file share one SKU (why "unique SKUs" starts switched on). */
  skusShared: boolean;
  /** A few titles of the file as supplied and as the chosen casing writes them. */
  samples: Array<{ before: string; after: string }>;
  onChange: (next: SanitizeOptions) => void;
}) {
  return (
    <fieldset className="rounded-2xl border border-neutral-800 bg-neutral-900/40 px-4 py-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-neutral-400">Export options</legend>
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-8">
        <label htmlFor="option-unique-skus" className="flex cursor-pointer items-start gap-2.5 text-sm text-neutral-200">
          <input
            id="option-unique-skus"
            type="checkbox"
            checked={options.uniqueSkus}
            onChange={(event) => onChange({ ...options, uniqueSkus: event.target.checked })}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-600 bg-neutral-900 accent-emerald-500"
          />
          <span>
            <span className="font-medium">Make SKUs unique per variant</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-neutral-500">
              Adds each variant&apos;s option values to its SKU, so SKU-1001 becomes SKU-1001-S-CERNA, SKU-1001-M-CERNA.{" "}
              {skusShared ? "On to start with because the variants of a product in your file share one SKU." : "Your variants already have different SKUs."}
            </span>
          </span>
        </label>
        <label htmlFor="option-active" className="flex cursor-pointer items-start gap-2.5 text-sm text-neutral-200">
          <input
            id="option-active"
            type="checkbox"
            checked={options.status === "active"}
            onChange={(event) => onChange({ ...options, status: event.target.checked ? "active" : "draft" })}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-600 bg-neutral-900 accent-emerald-500"
          />
          <span>
            <span className="font-medium">Import as active</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-neutral-500">
              Off: products arrive as drafts, hidden from your store until you publish them. On: they are live as soon as the import finishes.
            </span>
          </span>
        </label>
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-neutral-800 pt-3 sm:flex-row sm:gap-8">
        <label htmlFor="option-remove-duplicates" className="flex cursor-pointer items-start gap-2.5 text-sm text-neutral-200">
          <input
            id="option-remove-duplicates"
            type="checkbox"
            checked={options.removeDuplicates}
            onChange={(event) => onChange({ ...options, removeDuplicates: event.target.checked })}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-600 bg-neutral-900 accent-emerald-500"
          />
          <span>
            <span className="font-medium">Remove exact duplicates</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-neutral-500">
              A row that is the same as an earlier row in every cell is left out (the first one stays) and listed below. Off: it stays, and shows up as a duplicate variant.
            </span>
          </span>
        </label>
        <div className="flex flex-col gap-1.5 text-sm text-neutral-200">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <label htmlFor="option-no-retail-price" className="font-medium">
              For rows without a retail price
            </label>
            <select
              id="option-no-retail-price"
              value={options.noRetailPrice}
              onChange={(event) => onChange({ ...options, noRetailPrice: event.target.value === "markup" ? "markup" : "empty" })}
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-200 focus:border-emerald-500/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
            >
              <option value="empty">Leave the price empty</option>
              <option value="markup">Use wholesale price x markup</option>
            </select>
            {options.noRetailPrice === "markup" && <MarkupInput value={options.markupPercent} onCommit={(percent) => onChange({ ...options, markupPercent: percent })} />}
          </div>
          <p className="text-xs leading-relaxed text-neutral-500">
            {options.noRetailPrice === "markup"
              ? `A variant whose retail price is blank, TBC or POA gets its wholesale price plus ${options.markupPercent}% (100% doubles it). The wholesale price is always written to Cost per item.`
              : "A variant whose retail price is blank, TBC or POA is listed below and has no Variant Price. The wholesale price is written to Cost per item, never to Variant Price."}
          </p>
        </div>
      </div>

      <div className="mt-4 border-t border-neutral-800 pt-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label htmlFor="option-casing" className="text-sm font-medium text-neutral-200">
            Title casing
          </label>
          <select
            id="option-casing"
            value={options.casing}
            onChange={(event) => onChange({ ...options, casing: event.target.value as TitleCasing })}
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-200 focus:border-emerald-500/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            {CASING_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-neutral-500">Applies to titles and vendors.</span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-neutral-500">{CASING_HINT[options.casing]}</p>
        {samples.length > 0 && (
          <ul data-testid="casing-samples" aria-label="Examples from your file" className="mt-2 space-y-1 text-xs">
            {samples.map((sample) => (
              <li key={sample.before} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="break-words text-neutral-500">{sample.before}</span>
                <span aria-hidden="true" className="text-neutral-600">&rarr;</span>
                <span className="break-words font-medium text-emerald-300">{sample.after}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </fieldset>
  );
}
