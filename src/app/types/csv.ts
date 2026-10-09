// src/app/types/csv.ts

/**
 * One row exactly as it arrives from a supplier file, after header mapping.
 * Every value is a raw string: nothing has been trimmed, decoded or validated yet.
 */
export interface RawSupplierRow {
  id: string;
  title: string;
  description: string;
  /** One or many image URLs, often clumped together with `|`, `;` or `,`. */
  images: string;
  price: string;
  sku: string;
  /** Present only when the supplier file already ships a handle/slug column. */
  handle?: string;
}

/**
 * One row of the Shopify product import CSV.
 *
 * A product with several images becomes several rows that share the same
 * `Handle`. Only the first row carries the product data; every following row
 * carries just `Handle` + `Image_Src`, which is the structure Shopify expects.
 */
export interface CleanedShopifyRow {
  Handle: string;
  Title: string;
  Body_HTML: string;
  Image_Src: string;
  Variant_Price: string;
  Variant_SKU: string;
}

/** Counters describing what the sanitizer fixed, used for the dashboard stats. */
export interface SanitizeReport {
  productCount: number;
  outputRowCount: number;
  titlesFixed: number;
  descriptionsCleaned: number;
  handlesGenerated: number;
  duplicateHandlesResolved: number;
  pricesNormalized: number;
  /** Source rows that had more than one image clumped into a single cell. */
  imageCellsSplit: number;
  /** Extra image-only rows created for Shopify. */
  extraImageRows: number;
  invalidImagesDropped: number;
  /** Wall-clock time the sanitizer needed, in milliseconds. */
  processingMs: number;
}

/** Global state tracked by the page and handed down to child components. */
export interface CsvState {
  loading: boolean;
  error: string | null;
  rawData: RawSupplierRow[];
  cleanedData: CleanedShopifyRow[];
  fileName: string | null;
  warnings: string[];
  report: SanitizeReport | null;
}

/** One "before vs after" pair rendered by the preview dashboard. */
export interface PreviewPair {
  raw: RawSupplierRow;
  /** The first cleaned row of the product (carries all product fields). */
  primary: CleanedShopifyRow;
  /** Image-only rows that Shopify needs for the product's additional images. */
  extraImageRows: CleanedShopifyRow[];
}