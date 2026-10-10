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
  /**
   * The variant options of this row, one entry per option column of the file (at most three, in column order), present
   * only when the file has such columns. Shopify products can have up to three options, for example Size / Color / Material.
   */
  options?: RawOption[];
}

/** One variant option of a supplier row: "Size" = "M". */
export interface RawOption {
  /** The option's name: from the file's name column, or the column header itself (for a "Size" column). Not yet cleaned. */
  name: string;
  /** This row's value. Not yet cleaned. */
  value: string;
  /**
   * True when the option comes from a plain attribute column (a column headed "Size" or "Color") rather than from
   * Option1 Name / Option1 Value style columns. Such a column only becomes an option if it actually tells variants of a
   * product apart, because a "Style" column that says "Casual" on every product is a description, not an option.
   */
  derived: boolean;
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
  /**
   * Variant options. The names belong to the product, so they are only on its first row; every variant row carries its
   * own values. All empty for products without options.
   */
  Option1_Name: string;
  Option1_Value: string;
  Option2_Name: string;
  Option2_Value: string;
  Option3_Name: string;
  Option3_Value: string;
}

/** Counters describing what the sanitizer fixed, used for the dashboard stats. */
export interface SanitizeReport {
  /** Supplier rows that were cleaned (for a gated file this is the free preview, not the whole upload). */
  sourceRows: number;
  /** Distinct products among those rows: source rows minus the variant rows that attach to an earlier product. */
  productCount: number;
  /** Rows that repeated an earlier row's handle and were kept as variants of that product. */
  variantRows: number;
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
  /** Source rows that carry at least one option value (Size, Color, ...). */
  optionRows: number;
  /** Variant problems the file has that this tool cannot fix, as sentences for the user. */
  notices: string[];
  /** Wall-clock time the sanitizer needed, in milliseconds. */
  processingMs: number;
}

/**
 * Global state tracked by the page and handed down to child components.
 *
 * Paywall rule: only the free preview (the first FREE_ROW_LIMIT source rows, i.e. the whole file when it is free)
 * is ever cleaned before payment. `rawData` holds every parsed row so the paid export can run later, but
 * `cleanedData`, `rowStarts` and `report` describe the preview rows only.
 */
export interface CsvState {
  loading: boolean;
  error: string | null;
  fileName: string | null;
  fileSize: number;
  warnings: string[];
  rawData: RawSupplierRow[];
  cleanedData: CleanedShopifyRow[];
  rowStarts: number[];
  report: SanitizeReport | null;
  /** Content hash of the parsed rows. Ties a payment to one file so it can be recovered on another device. */
  fingerprint: string | null;
}

/** One "before vs after" pair rendered by the preview dashboard. */
export interface PreviewPair {
  raw: RawSupplierRow;
  /** The first cleaned row of the source row (carries all of its fields). */
  primary: CleanedShopifyRow;
  /** Image-only rows that Shopify needs for the source row's additional images. */
  extraImageRows: CleanedShopifyRow[];
  /** True when the source row is a further variant of an earlier product (no title or body of its own). */
  isVariantRow: boolean;
}
