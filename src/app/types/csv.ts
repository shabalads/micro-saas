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
  /**
   * A column that names the product a row belongs to ("Product code", "Kod produktu", "Parent SKU", "Group ID"): the
   * variants of one product share it. Present only when the file has such a column. (A plain SKU column that several
   * variants share works the same way; the cleaner detects that itself, see sanitizeDataset.)
   */
  productCode?: string;
  /** Each of the following is present only when the file has the column. All are raw: nothing is trimmed or validated yet. */
  vendor?: string;
  /** The supplier's category, which becomes Shopify's product Type. */
  category?: string;
  tags?: string;
  stock?: string;
  /** EAN / UPC / GTIN. */
  barcode?: string;
  currency?: string;
  weight?: string;
  /** The unit the weight column's header names ("kg" for "Weight (kg)"), or "" when it names none. */
  weightUnit?: string;
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
  /** Product-level (first row of the product only), like Title: */
  Vendor: string;
  Type: string;
  Tags: string;
  /** "draft" or "active" (see SanitizeOptions), first row of the product only. */
  Status: string;
  /** Per variant row: */
  Variant_Grams: string;
  /** "shopify" when the row has a quantity (Shopify then tracks the stock), otherwise empty. */
  Variant_Inventory_Tracker: string;
  Variant_Inventory_Qty: string;
  Variant_Barcode: string;
  /** 1, 2, 3 ... in the order the product's images are written, next to Image_Src. */
  Image_Position: string;
}

/**
 * How product titles and vendors are cased. "title": ALL CAPS and all lower case become Title Case, mixed case is left
 * alone (the default, and what the tool always did). "sentence": only the first letter, acronyms, tokens with digits and
 * words that were already mixed-case ("iPhone") keep their capitals. "keep": as supplied.
 */
export type TitleCasing = "title" | "sentence" | "keep";

/** What the person can switch in the tool. All of them change the file that is written. */
export interface SanitizeOptions {
  /**
   * Make every variant's SKU unique by adding its option values: SKU-1001 shared by five variants becomes
   * SKU-1001-S-CERNA, SKU-1001-M-CERNA ... Which SKUs changed is reported (SanitizeReport.skuChanges).
   */
  uniqueSkus: boolean;
  /** Shopify's product Status for every product: "draft" (the safe default) or "active". */
  status: "draft" | "active";
  /** The casing of Title and Vendor. */
  casing: TitleCasing;
}

/** One SKU that was rewritten because "Make SKUs unique per variant" is on. */
export interface SkuChange {
  /** Source row number (1-based, the header row not counted). */
  row: number;
  from: string;
  to: string;
}

/** The kinds of problem the cleaner reports. Each becomes one entry of the warnings panel. */
export type WarningKind =
  | "duplicate_sku_in_product"
  | "duplicate_sku_across_products"
  | "sku_changed"
  | "duplicate_variant"
  | "missing_option_value"
  | "option_name_conflict"
  | "split_product"
  | "sku_copied"
  | "invalid_ean"
  | "ean_check_digit"
  | "non_numeric_stock"
  | "invalid_weight"
  | "weight_unit_assumed"
  | "placeholder_description"
  | "mixed_currencies"
  | "currency_symbol_in_price"
  | "invalid_image_url";

/** One kind of problem, with how many rows it touches and which (the first ones), for the warnings panel. */
export interface SanitizeWarning {
  kind: WarningKind;
  /** "warning": something the person should look at. "info": the cleaner already dealt with it, here is what it did. */
  severity: "warning" | "info";
  /** A few words: "Duplicate SKUs within a product". */
  title: string;
  /** A sentence or two saying what was found and what happened to it. */
  message: string;
  /** How many source rows it touches. */
  count: number;
  /** The first MAX_WARNING_ROWS of those rows, ascending. Source row numbers, 1-based, the header row not counted. */
  rows: number[];
  /** What the cleaner did about it, when it did something. */
  resolution?: string;
  /** One short line per listed row, in the same order ("SKU-1001 -> SKU-1001-S-CERNA"), when there is something to say about each. */
  details?: string[];
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
  /** Everything the cleaner found that the person should know, grouped by kind (see SanitizeWarning). Empty for a clean file. */
  warnings: SanitizeWarning[];
  /** Every SKU that "Make SKUs unique per variant" rewrote. warnings has the first few; this is all of them. */
  skuChanges: SkuChange[];
  /** The options this report was made with, so the screen can show what is switched on. */
  options: SanitizeOptions;
  /** Image URLs that repeated an earlier image of the same product and were written once. */
  duplicateImagesRemoved: number;
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
