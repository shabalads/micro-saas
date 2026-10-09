// src/app/components/csv-uploader.tsx
// No "use client" directive on purpose: this module is only imported by the client page, so it is
// already part of the client bundle. Declaring it a client entry would make Next flag the callback
// props (ts 71007) even though no server/client boundary is crossed here.

import { useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import type { RawSupplierRow } from "../types/csv";
import { parseSupplierFile, parseSupplierText } from "../utils/csv-parser";

/* -------------------------------------------------------------------------- */
/*  Configuration                                                              */
/* -------------------------------------------------------------------------- */

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".csv", ".tsv", ".txt"];

/** Deliberately messy demo feed so the before/after value is visible without a file at hand. */
export const SAMPLE_FILE_NAME = "sample-supplier-feed.csv";
const SAMPLE_ROWS: string[][] = [
  ["id", "title", "description", "images", "price", "sku"],
  [
    "1001",
    "  BLUE   T-SHIRT 123  ",
    '<div style="font-family:Arial;color:#333"><font face="Verdana" size="2">100% <b>organic cotton</b> tee.</font><br><br>Pre-shrunk, <span class="hl">machine washable</span>.</div>',
    "https://cdn.example.com/tee-blue-front.jpg|https://cdn.example.com/tee-blue-back.jpg|https://cdn.example.com/tee-blue-detail.jpg",
    "$24.50",
    "TSH-BLU-123 ",
  ],
  [
    "1002",
    "WIRELESS BLUETOOTH HEADPHONES  NOISE CANCELLING",
    '<p style="MARGIN: 0cm 0cm 0pt" class="MsoNormal"><span style="FONT-SIZE: 10pt"><o:p>Over-ear headphones with 30h battery.</o:p></span></p><ul style="margin-left:20px"><li>Active noise cancelling</li><li>Bluetooth 5.3</li><li>USB-C fast charge</li></ul>',
    "https://cdn.example.com/hp-black.jpg, https://cdn.example.com/hp-black-side.jpg",
    "89,90 €",
    "HP-NC-30",
  ],
  [
    "1003",
    "STAINLESS STEEL WATER BOTTLE 750ML",
    '<table border="1" cellpadding="4"><tr><td>Capacity</td><td>750 ml</td></tr><tr><td>Material</td><td>18/8 stainless steel</td></tr></table><center>Keeps drinks cold for 24h!</center>',
    "//cdn.example.com/bottle.jpg",
    "USD 19.9",
    "BTL-750-SS",
  ],
  [
    "1004",
    "leather wallet slim rfid blocking",
    "Slim bifold wallet.\nHolds up to 8 cards.\n\nGenuine leather.",
    "wallet-brown.jpg",
    "£12.5",
    "N/A",
  ],
  [
    "1005",
    "CERAMIC COFFEE MUG 350ML SET OF 2",
    "Hand-painted&nbsp;mugs &amp; gift box.<br>Dishwasher &amp; microwave safe.",
    "https://cdn.example.com/mug-1.jpg|https://cdn.example.com/mug-2.jpg",
    "1 299,00 Kč",
    "MUG-350-2PK",
  ],
  [
    "1006",
    "USB-C CHARGING CABLE 2M 100W LED",
    "<div><b>Fast charging</b> braided cable.</div><div>&nbsp;</div>",
    "https://cdn.example.com/cable-1.jpg;https://cdn.example.com/cable-2.jpg;https://cdn.example.com/cable-3.jpg;https://cdn.example.com/cable-4.jpg",
    "9.99",
    "USB-C-2M",
  ],
  [
    "1007",
    "BLUE T-SHIRT 123",
    "<font color=\"red\">Same shirt, different supplier SKU.</font>",
    "https://cdn.example.com/tee-blue-alt.jpg",
    "24.50 USD",
    "TSH-BLU-124",
  ],
  [
    "1008",
    "YOGA MAT NON SLIP 6MM",
    "<div>&nbsp;</div>",
    "https://cdn.example.com/yoga.jpg",
    "29,5",
    "YOGA-6MM",
  ],
];

function buildSampleCsv(): string {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return SAMPLE_ROWS.map((row) => row.map(quote).join(",")).join("\r\n");
}

/* -------------------------------------------------------------------------- */
/*  File validation                                                            */
/* -------------------------------------------------------------------------- */

function hasAcceptedExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

interface CsvUploaderProps {
  /** Fired as soon as a valid file is accepted, so the page can show its loading state. */
  onFileLoadStart: (fileName: string) => void;
  /** Fired with the parsed rows (and non-fatal warnings) once parsing succeeded. */
  onDataParsed: (rows: RawSupplierRow[], fileName: string, warnings: string[]) => void;
  /** Fired with a human-readable message when the file is rejected or unreadable. */
  onError: (message: string) => void;
}

function joinClasses(...classes: Array<string | false>): string {
  return classes.filter(Boolean).join(" ");
}

export default function CsvUploader({ onFileLoadStart, onDataParsed, onError }: CsvUploaderProps) {
  const dragDepth = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = async (file: File) => {
    if (!hasAcceptedExtension(file.name) && !file.type.includes("csv")) {
      onError(`"${file.name}" is not a CSV file. Please upload a .csv, .tsv or .txt export from your supplier.`);
      return;
    }
    if (file.size === 0) {
      onError(`"${file.name}" is empty.`);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      onError(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit for this prototype is 25 MB.`);
      return;
    }

    onFileLoadStart(file.name);
    try {
      const { rows, warnings } = await parseSupplierFile(file);
      onDataParsed(rows, file.name, warnings);
    } catch (error) {
      onError(error instanceof Error ? error.message : "The file could not be read.");
    }
  };

  const handleSample = () => {
    onFileLoadStart(SAMPLE_FILE_NAME);
    try {
      const { rows, warnings } = parseSupplierText(buildSampleCsv());
      onDataParsed(rows, SAMPLE_FILE_NAME, warnings);
    } catch (error) {
      onError(error instanceof Error ? error.message : "The sample file could not be parsed.");
    }
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void handleFile(file);
  };

  const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");

  const handleDragEnter = (event: DragEvent<HTMLLabelElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth.current++;
    setIsDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLLabelElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: DragEvent<HTMLLabelElement>) => {
    if (!isFileDrag(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  return (
    <div className="w-full">
      <label
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={joinClasses(
          "group relative flex w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed px-6 py-16 text-center transition-all duration-300 ease-out sm:py-24",
          "focus-within:ring-2 focus-within:ring-emerald-400/70 focus-within:ring-offset-2 focus-within:ring-offset-neutral-950",
          isDragging
            ? "scale-[1.015] border-emerald-400 bg-emerald-500/10 shadow-[0_0_90px_-20px] shadow-emerald-500/50"
            : "border-neutral-700 bg-neutral-900/50 hover:border-emerald-500/60 hover:bg-neutral-900/80",
        )}
      >
        <input
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          onChange={handleInputChange}
          className="sr-only"
          aria-label="Upload supplier CSV file"
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_0%,rgba(16,185,129,0.12),transparent)] opacity-60 transition-opacity duration-300 group-hover:opacity-100"
        />

        <div className="relative mb-6">
          {isDragging && (
            <span className="absolute inset-0 animate-pulse-ring rounded-full bg-emerald-400/40 motion-reduce:animate-none" />
          )}
          <div
            className={joinClasses(
              "relative flex h-20 w-20 items-center justify-center rounded-full border transition-all duration-300",
              isDragging
                ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                : "border-neutral-700 bg-neutral-800 text-neutral-300 group-hover:border-emerald-500/60 group-hover:text-emerald-300",
            )}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={joinClasses("h-9 w-9 transition-transform duration-300", isDragging ? "-translate-y-1" : "group-hover:-translate-y-0.5")}
            >
              <path d="M12 16V4" />
              <path d="m7 9 5-5 5 5" />
              <path d="M20 16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2" />
            </svg>
          </div>
        </div>

        <p className="relative text-xl font-semibold tracking-tight text-neutral-50 sm:text-2xl">
          {isDragging ? "Release to start cleaning" : "Drop your messy supplier CSV here"}
        </p>
        <p className="relative mt-2 max-w-md text-sm text-neutral-400 sm:text-base">
          or <span className="font-medium text-emerald-400 underline-offset-4 group-hover:underline">browse your computer</span>
          . Works with .csv, .tsv and semicolon-separated exports up to 25 MB.
        </p>

        <div className="relative mt-8 flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-950/60 px-4 py-2 text-xs text-neutral-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          Processed locally in your browser. Your file is never uploaded.
        </div>
      </label>

      <div className="mt-5 flex flex-col items-center justify-center gap-1 text-sm text-neutral-500 sm:flex-row sm:gap-3">
        <span>No file at hand?</span>
        <button
          type="button"
          onClick={handleSample}
          className="rounded-full border border-neutral-700 bg-neutral-900 px-4 py-1.5 font-medium text-neutral-200 transition hover:border-emerald-500/70 hover:text-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
        >
          Try it with a messy sample feed
        </button>
      </div>
    </div>
  );
}