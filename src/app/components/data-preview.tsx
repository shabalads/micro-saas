// src/app/components/data-preview.tsx
"use client";

import { Fragment, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  CleanedShopifyRow,
  PreviewPair,
  RawSupplierRow,
  SanitizeReport,
} from "../types/csv";
import { buildPreviewPairs, shopifyHeaderOf } from "../utils/sanitizer";

/* -------------------------------------------------------------------------- */
/*  Constants & small helpers                                                  */
/* -------------------------------------------------------------------------- */

const PREVIEW_ROW_COUNT = 5;
const MAX_MARKUP_CHARS = 420;
/** Used only for the "time saved" estimate shown to the merchant. */
const MANUAL_SECONDS_PER_PRODUCT = 45;

type Tone = "messy" | "clean" | "neutral";

const TONES: Record<Tone, { box: string; label: string; text: string }> = {
  messy: {
    box: "border-rose-500/30 bg-rose-950/20",
    label: "text-rose-300",
    text: "text-rose-300",
  },
  clean: {
    box: "border-emerald-500/30 bg-emerald-950/20 backdrop-blur-sm",
    label: "text-emerald-300",
    text: "text-emerald-300",
  },
  neutral: {
    box: "border-neutral-800 bg-neutral-900/50",
    label: "text-neutral-600",
    text: "text-neutral-400",
  },
};

function shopifyHeader(key: keyof CleanedShopifyRow): string {
  return shopifyHeaderOf(key);
}

/** The catalog columns of a supplier row (vendor, category, stock, EAN) as one line, "name: value", only for the columns the file has. */
function catalogOf(raw: RawSupplierRow): string[] {
  const entries: Array<[string, string | undefined]> = [["vendor", raw.vendor], ["category", raw.category], ["stock", raw.stock], ["ean", raw.barcode]];
  return entries.filter(([, value]) => value !== undefined).map(([name, value]) => `${name}: ${(value as string) === "" ? "(empty)" : value}`);
}

/** What was written for them: Vendor, Type, Qty and Barcode of the row, only where there is something. */
function catalogWritten(row: CleanedShopifyRow): string[] {
  const entries: Array<[string, string]> = [
    [shopifyHeader("Vendor"), row.Vendor],
    [shopifyHeader("Type"), row.Type],
    [shopifyHeader("Variant_Inventory_Qty"), row.Variant_Inventory_Qty],
    [shopifyHeader("Variant_Barcode"), row.Variant_Barcode],
  ];
  return entries.filter(([, value]) => value !== "").map(([name, value]) => `${name}: ${value}`);
}

/** "size: S", "color: NAVY": the options of a supplier row as they were typed. */
function optionsOf(raw: RawSupplierRow): string[] {
  return (raw.options ?? []).filter((option) => option.value.trim() !== "").map((option) => `${option.name.trim()}: ${option.value.trim()}`);
}

function optionValues(row: CleanedShopifyRow): string[] {
  return [row.Option1_Value, row.Option2_Value, row.Option3_Value].filter((value) => value !== "");
}

/** "Size: S, Color: Navy" on a product's first row; just the values ("M, Navy") on its variant rows, which carry no names. */
function optionSummary(row: CleanedShopifyRow): string {
  const pairs = [[row.Option1_Name, row.Option1_Value], [row.Option2_Name, row.Option2_Value], [row.Option3_Name, row.Option3_Value]].filter(([, value]) => value !== "");
  return pairs.map(([name, value]) => (name ? `${name}: ${value}` : value)).join(", ");
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) + "…" : value;
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 1) return "under a minute";
  if (minutes < 90) return `${minutes} min`;
  return `${(minutes / 60).toFixed(1)} hours`;
}

/* -------------------------------------------------------------------------- */
/*  Value renderers                                                            */
/* -------------------------------------------------------------------------- */

const EMPTY_LABEL = <span className="italic text-neutral-500">empty</span>;

/** Makes rogue whitespace (leading, trailing, doubled, tabs, line breaks) visible in the "before" column. */
function VisibleWhitespace({ value }: { value: string }) {
  if (value === "") return EMPTY_LABEL;
  const parts = value.split(/(^ +| {2,}| +$|[\t\r\n]+)/);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className="rounded-sm bg-rose-400/25 text-rose-300" title="Extra whitespace">
            {part.replace(/ /g, "·").replace(/\t/g, "→").replace(/[\r\n]/g, "↵")}
          </span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** Shows HTML source with the tags dimmed, so noisy markup versus clean semantic markup is obvious. */
function MarkupSource({ value, tagClassName }: { value: string; tagClassName: string }) {
  if (value.trim() === "") return EMPTY_LABEL;
  const shown = truncate(value.replace(/[\r\n]+/g, " ↵ "), MAX_MARKUP_CHARS);
  return (
    <span className="line-clamp-5 font-mono text-[12.5px] leading-relaxed" title={value}>
      {shown.split(/(<[^>]*>?)/).map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className={tagClassName}>
            {part}
          </span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </span>
  );
}

function PlainMono({ value }: { value: string }) {
  if (value === "") return EMPTY_LABEL;
  return <span className="font-mono text-[13px]">{value}</span>;
}

/* -------------------------------------------------------------------------- */
/*  Layout building blocks                                                     */
/* -------------------------------------------------------------------------- */

function Cell({
  tone,
  side,
  label,
  note,
  children,
}: {
  tone: Tone;
  side: "before" | "after";
  label: string;
  note?: string;
  children: ReactNode;
}) {
  const styles = TONES[tone];
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 rounded-xl border px-3.5 py-3 ${styles.box}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${styles.label}`}>
          <span className="mr-1.5 lg:hidden">{side === "before" ? "Before" : "After"} &middot;</span>
          {label}
        </span>
        {note && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${tone === "neutral" ? "bg-neutral-800 text-neutral-400" : tone === "messy" ? "bg-rose-500/20 text-rose-200" : "bg-emerald-500/20 text-emerald-200"}`}>
            {note}
          </span>
        )}
      </div>
      <div className={`min-w-0 break-words text-sm leading-relaxed ${styles.text}`}>{children}</div>
    </div>
  );
}

function ArrowConnector({ active }: { active: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`flex items-center justify-center py-0.5 lg:py-0 ${active ? "text-emerald-400" : "text-neutral-700"}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4 rotate-90 lg:rotate-0"
      >
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </svg>
    </div>
  );
}

function FieldRow({
  changed,
  before,
  after,
}: {
  changed: boolean;
  before: { label: string; note?: string; content: ReactNode };
  after: { label: string; note?: string; content: ReactNode };
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)]">
      <Cell tone={changed ? "messy" : "neutral"} side="before" label={before.label} note={before.note}>
        {before.content}
      </Cell>
      <ArrowConnector active={changed} />
      <Cell tone={changed ? "clean" : "neutral"} side="after" label={after.label} note={after.note}>
        {after.content}
      </Cell>
    </div>
  );
}

function ImageList({ urls }: { urls: string[] }) {
  if (urls.length === 0) return <span className="italic text-neutral-500">no valid image URL</span>;
  return (
    <ol className="flex flex-col gap-1.5">
      {urls.map((url, index) => (
        <li key={`${url}-${index}`} className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-200">
            {index === 0 ? "ROW 1" : `ROW ${index + 1}`}
          </span>
          <span className="min-w-0 break-all font-mono text-[12.5px] leading-snug" title={url}>
            {truncate(url, 90)}
          </span>
        </li>
      ))}
    </ol>
  );
}

interface Metric {
  label: string;
  /** Numeric value that decides whether the card is lit (> 0) or dimmed (0). */
  count: number;
  value: string;
  hint?: string;
}

function buildMetrics(report: SanitizeReport): Metric[] {
  return [
    { label: "Titles fixed", count: report.titlesFixed, value: report.titlesFixed.toLocaleString(), hint: "casing & spacing" },
    { label: "Descriptions cleaned", count: report.descriptionsCleaned, value: report.descriptionsCleaned.toLocaleString(), hint: "font, div, style removed" },
    {
      label: "Handles generated",
      count: report.handlesGenerated,
      value: report.handlesGenerated.toLocaleString(),
      hint: report.variantRows > 0 ? `${report.variantRows.toLocaleString()} variant rows grouped` : report.duplicateHandlesResolved > 0 ? `${report.duplicateHandlesResolved.toLocaleString()} duplicates resolved` : "all unique",
    },
    { label: "Image cells split", count: report.imageCellsSplit, value: report.imageCellsSplit.toLocaleString(), hint: `+${report.extraImageRows.toLocaleString()} image rows` },
    { label: "Prices normalized", count: report.pricesNormalized, value: report.pricesNormalized.toLocaleString(), hint: "plain decimals" },
    { label: "Processing time", count: report.processingMs, value: `${report.processingMs.toLocaleString()} ms`, hint: "entirely in-browser" },
  ];
}

function MetricCard({ metric }: { metric: Metric }) {
  const active = metric.count > 0;
  return (
    <div
      className={`rounded-2xl border px-4 py-4 transition ${
        active
          ? "border-emerald-500/30 bg-neutral-900/70 shadow-[0_0_28px_-10px] shadow-emerald-500/40"
          : "border-neutral-800 bg-neutral-900/40 opacity-40"
      }`}
    >
      <p
        className={`text-2xl font-semibold tracking-tight tabular-nums ${
          active ? "text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.45)]" : "text-neutral-500"
        }`}
      >
        {metric.value}
      </p>
      <p className="mt-1 text-sm text-neutral-300">{metric.label}</p>
      {metric.hint && <p className="mt-0.5 text-xs text-neutral-500">{metric.hint}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  One product: six aligned before/after field rows                           */
/* -------------------------------------------------------------------------- */

function ProductComparison({ pair, position, total }: { pair: PreviewPair; position: number; total: number }) {
  const { raw, primary, extraImageRows } = pair;
  const imageUrls = [primary.Image_Src, ...extraImageRows.map((row) => row.Image_Src)].filter(Boolean);
  const shopifyRowCount = 1 + extraImageRows.length;
  const handleChanged = raw.handle === undefined || raw.handle !== primary.Handle;

  return (
    <article
      className="animate-fade-up rounded-2xl border border-neutral-800 bg-neutral-900/40 p-3 sm:p-4 motion-reduce:animate-none"
      style={{ animationDelay: `${position * 70}ms` }}
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-sm font-medium text-neutral-200">
          Row {position + 1} <span className="text-neutral-500">of {total.toLocaleString()}</span>
          {pair.isVariantRow && (
            <span className="ml-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-200" title="This row repeats an earlier handle, so it is a further variant of that product">
              variant of {primary.Handle}
            </span>
          )}
          {raw.id.trim() !== "" && <span className="ml-2 font-mono text-xs text-neutral-500">supplier id {raw.id.trim()}</span>}
        </p>
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
          {shopifyRowCount === 1 ? "1 Shopify row" : `${shopifyRowCount} Shopify rows`}
        </span>
      </header>

      <div className="flex flex-col gap-1.5">
        <FieldRow
          changed={handleChanged}
          before={{
            label: "handle",
            note: raw.handle === undefined ? "missing" : undefined,
            content: raw.handle === undefined ? <span className="italic text-rose-300/80">no handle column</span> : <PlainMono value={raw.handle} />,
          }}
          after={{ label: shopifyHeader("Handle"), note: pair.isVariantRow ? "shared" : "generated", content: <PlainMono value={primary.Handle} /> }}
        />

        <FieldRow
          changed={raw.title !== primary.Title}
          before={{
            label: "title",
            note: raw.title !== primary.Title ? "messy" : "clean",
            content: <VisibleWhitespace value={raw.title} />,
          }}
          after={{
            label: shopifyHeader("Title"),
            note: raw.title !== primary.Title ? "fixed" : "kept",
            content: <span className="font-medium">{primary.Title}</span>,
          }}
        />

        <FieldRow
          changed={raw.description !== primary.Body_HTML}
          before={{
            label: "description",
            note: raw.description !== primary.Body_HTML ? "legacy markup" : "clean",
            content: <MarkupSource value={raw.description} tagClassName="text-rose-400/80" />,
          }}
          after={{
            label: shopifyHeader("Body_HTML"),
            note: raw.description !== primary.Body_HTML ? "semantic html" : "kept",
            content: <MarkupSource value={primary.Body_HTML} tagClassName="text-emerald-400/70" />,
          }}
        />

        <FieldRow
          changed={raw.images !== primary.Image_Src || extraImageRows.length > 0}
          before={{
            label: "images",
            note: imageUrls.length > 1 ? `${imageUrls.length} clumped in 1 cell` : undefined,
            content: raw.images.trim() === "" ? EMPTY_LABEL : (
              <span className="line-clamp-4 break-all font-mono text-[12.5px] leading-snug" title={raw.images}>
                {truncate(raw.images, 260)}
              </span>
            ),
          }}
          after={{
            label: shopifyHeader("Image_Src"),
            note: imageUrls.length > 1 ? `split into ${imageUrls.length} rows` : undefined,
            content: <ImageList urls={imageUrls} />,
          }}
        />

        <FieldRow
          changed={raw.price !== primary.Variant_Price}
          before={{
            label: "price",
            note: raw.price !== primary.Variant_Price ? "inconsistent" : "clean",
            content: <VisibleWhitespace value={raw.price} />,
          }}
          after={{
            label: shopifyHeader("Variant_Price"),
            note: raw.price !== primary.Variant_Price ? "normalized" : "kept",
            content: <PlainMono value={primary.Variant_Price} />,
          }}
        />

        <FieldRow
          changed={raw.sku !== primary.Variant_SKU}
          before={{
            label: "sku",
            note: raw.sku !== primary.Variant_SKU ? "messy" : "clean",
            content: <VisibleWhitespace value={raw.sku} />,
          }}
          after={{
            label: shopifyHeader("Variant_SKU"),
            note: raw.sku !== primary.Variant_SKU ? "fixed" : "kept",
            content: <PlainMono value={primary.Variant_SKU} />,
          }}
        />

        {catalogOf(raw).length > 0 && (
          <FieldRow
            changed={catalogOf(raw).join(" | ") !== catalogWritten(primary).join(" | ")}
            before={{
              label: "vendor / category / stock / ean",
              note: "as supplied",
              content: <VisibleWhitespace value={catalogOf(raw).join(" | ")} />,
            }}
            after={{
              label: "Vendor / Type / Inventory Qty / Barcode",
              note: pair.isVariantRow ? "this variant" : "kept",
              content: catalogWritten(primary).length > 0 ? <PlainMono value={catalogWritten(primary).join(" | ")} /> : <span className="italic text-neutral-500">nothing usable (see the warnings)</span>,
            }}
          />
        )}

        {(optionsOf(raw).length > 0 || optionValues(primary).length > 0) && (
          <FieldRow
            changed={optionsOf(raw).join(" / ") !== optionValues(primary).join(" / ")}
            before={{
              label: "options",
              note: optionsOf(raw).length > 0 ? "as supplied" : "none",
              content: optionsOf(raw).length > 0 ? <VisibleWhitespace value={optionsOf(raw).join(" | ")} /> : EMPTY_LABEL,
            }}
            after={{
              label: "Option1-3 Name / Value",
              note: pair.isVariantRow ? "value only" : "named",
              content: <PlainMono value={optionSummary(primary)} />,
            }}
          />
        )}
      </div>
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/*  Public component                                                           */
/* -------------------------------------------------------------------------- */

interface DataPreviewProps {
  rawData: RawSupplierRow[];
  cleanedData: CleanedShopifyRow[];
  /** Where each cleaned source row begins in cleanedData (from sanitizeDataset). */
  rowStarts: number[];
  report: SanitizeReport;
  /** Rows in the whole upload. Larger than report.sourceRows when only the free preview has been cleaned. */
  totalRows: number;
}

export default function DataPreview({ rawData, cleanedData, rowStarts, report, totalRows }: DataPreviewProps) {
  const [showAll, setShowAll] = useState(false);
  const isPartial = totalRows > report.sourceRows;
  const shownCount = showAll ? report.sourceRows : Math.min(PREVIEW_ROW_COUNT, report.sourceRows);

  const pairs = useMemo(
    () => buildPreviewPairs(rawData, cleanedData, rowStarts, shownCount),
    [rawData, cleanedData, rowStarts, shownCount],
  );
  const metrics = useMemo(() => buildMetrics(report), [report]);
  const savedSeconds = totalRows * MANUAL_SECONDS_PER_PRODUCT;

  return (
    <section aria-labelledby="preview-heading" className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        {isPartial && (
          <p className="text-xs text-neutral-500">
            These counts cover the free preview: the first {report.sourceRows.toLocaleString()} of your {totalRows.toLocaleString()} rows.
            Nothing beyond the preview is cleaned until the file is unlocked.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {metrics.map((metric) => (
            <MetricCard key={metric.label} metric={metric} />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/15 via-emerald-500/5 to-transparent px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-base text-emerald-50 sm:text-lg">
          {isPartial ? "Cleaning all " + totalRows.toLocaleString() + " rows by hand would take roughly " : "That is roughly "}
          <strong className="font-semibold text-emerald-300" title={`Estimate: about ${MANUAL_SECONDS_PER_PRODUCT} seconds of manual spreadsheet work per product`}>
            {formatDuration(savedSeconds)}
          </strong>
          {isPartial ? "." : " of manual spreadsheet cleanup you just skipped."}
        </p>
        <p className="text-xs text-emerald-200/60">Estimate at ~{MANUAL_SECONDS_PER_PRODUCT}s of Excel work per product</p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="preview-heading" className="text-xl font-semibold tracking-tight text-neutral-50 sm:text-2xl">
              Before vs. after
            </h2>
            <p className="mt-1 text-sm text-neutral-400">
              {isPartial
                ? `Showing ${pairs.length} of the ${report.sourceRows.toLocaleString()} free preview rows (${totalRows.toLocaleString()} in your file). `
                : `Showing ${pairs.length} of ${totalRows.toLocaleString()} rows. `}
              Red is what your supplier sent, green is what Shopify will import.
            </p>
          </div>
          {report.sourceRows > PREVIEW_ROW_COUNT && (
            <button
              type="button"
              onClick={() => setShowAll((current) => !current)}
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-neutral-200 transition hover:border-neutral-500 hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
            >
              {showAll ? `Show only the first ${PREVIEW_ROW_COUNT}` : `Show all ${report.sourceRows.toLocaleString()} ${isPartial ? "preview " : ""}rows`}
            </button>
          )}
        </div>

        <div className="sticky top-2 z-10 hidden grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] rounded-xl bg-neutral-950/80 py-1 backdrop-blur lg:grid">
          <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/15 px-4 py-2.5 text-sm font-semibold text-rose-200">
            <span className="h-2 w-2 rounded-full bg-rose-400" />
            Before &middot; Messy supplier data
          </div>
          <span />
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-2.5 text-sm font-semibold text-emerald-200">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            After &middot; Cleaned Shopify format
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {pairs.map((pair, index) => (
            <ProductComparison
              key={`${pair.primary.Handle}-${index}`}
              pair={pair}
              position={index}
              total={totalRows}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
