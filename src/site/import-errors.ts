// src/site/import-errors.ts
//
// The data behind the /fix/<slug> pages: one entry per Shopify product-import problem. Add an entry and a page, its
// sitemap line and its OpenGraph image appear on the next build.
//
// Accuracy rules for this file:
//  * `shopifyMessage` is only set when Shopify's own help page prints that exact text. Where it does not, the page
//    describes the symptom in plain words and never invents an error string.
//  * Rules about columns come from Shopify's CSV format reference (handle: letters, dashes and numbers, no spaces;
//    variant rows skip Title; Image Src must be a public https URL; Variant Price is a bare number; UTF-8; 15 MB).
//  * `coverage` says honestly what this tool does about the problem: "fixes" (automatically), "helps" (part of it, the
//    rest is yours) or "manual" (it does not fix it). A test proves each "fixes" demo really changes the data.

import type { RawSupplierRow } from "../app/types/csv";

export type Coverage = "fixes" | "helps" | "manual";
export type DemoField = "title" | "handle" | "description" | "images" | "price" | "sku";

/** A small example that is run through the real parser and sanitizer when the page is built. */
export type DemoSpec =
  | {
      kind: "rows";
      rows: Array<Partial<RawSupplierRow>>;
      field: DemoField;
      /** Text that must appear in the cleaned output. A test checks it, so a "fixes" claim cannot rot. */
      expect: string;
      /** Also report how many bytes the field shrank by. */
      sizes?: boolean;
    }
  | { kind: "csv"; text: string; view: "rows" | "headers" | "options"; expect: string }
  /** `text` saved in a legacy single-byte encoding (default windows-1252), then read by the tool. */
  | { kind: "bytes"; text: string; encoding?: "windows-1252" | "windows-1250" | "windows-1251"; expect: string };

export interface ImportErrorGuide {
  slug: string;
  /** <title> and og:title. 60 characters or fewer. */
  title: string;
  /** Meta description. 155 characters or fewer. */
  description: string;
  heading: string;
  /** Exact text from Shopify's help center, or null when the page describes a symptom instead. */
  shopifyMessage: string | null;
  intro: string;
  causes: string[];
  steps: string[];
  coverage: Coverage;
  toolNote: string;
  demo: DemoSpec | null;
  related: string[];
  /** ISO date the guide was last checked. Used in the sitemap and structured data. */
  updated: string;
}

/** Shopify's own page for these errors, cited on every guide whose message is quoted from it. */
export const SHOPIFY_ERRORS_URL = "https://help.shopify.com/en/manual/products/import-export/common-import-issues";
export const SHOPIFY_CSV_FORMAT_URL = "https://help.shopify.com/en/manual/products/import-export/using-csv";
export const SHOPIFY_IMPORT_URL = "https://help.shopify.com/en/manual/products/import-export/import-products";

const UPDATED = "2026-10-09";

export const IMPORT_ERRORS: ImportErrorGuide[] = [
  {
    slug: "ignored-line-handle-already-exists",
    title: "Fix: Ignored line because handle already exists",
    description:
      "Shopify skips CSV lines whose handle already exists. Why supplier files produce duplicate handles, and how to give each product a unique one in one pass.",
    heading: "“Ignored line … because handle already exists” in a Shopify CSV import",
    shopifyMessage: 'Ignored line #-## because handle "example" already exists',
    intro:
      "You import a few hundred products, the progress bar finishes, and the results list is full of lines Shopify refused to touch. Each of them names a handle that Shopify believes it has already seen. Nothing is wrong with the line itself; the problem is that the handle is not unique where Shopify looks.",
    causes: [
      "The handle is the one identifier Shopify uses for a product, so two different products can never share it. Supplier feeds break this constantly: the handle column is empty, so someone filled it by copying the title, and two products called “Blue Mug” now collide.",
      "The same message appears when a product with that handle is already in your store and you did not tick the option to overwrite products with matching handles. In that case Shopify ignores the matching rows by design.",
      "There is one legitimate reason for repeated handles: variants and extra images. Shopify reads rows that repeat a handle as more rows of the same product, so a duplicate you meant as a separate product gets folded in or ignored.",
    ],
    steps: [
      "Sort the file by handle and look for repeats. Decide for each repeat whether it is a variant of one product (keep the handle and leave Title blank on the later rows) or a separate product (give it its own handle).",
      "Make handles unique: lower case, letters, numbers and dashes only. Appending a short supplier code or a number is enough, for example blue-mug and blue-mug-2.",
      "If the products already exist in your store and you want to replace them, tick the overwrite option in the import dialog. If you only want to add new ones, remove the existing handles from the file.",
      "Re-import a small slice first to confirm the ignored lines are gone.",
    ],
    coverage: "fixes",
    toolNote:
      "Rows that repeat a handle with a blank or identical title are kept as variants of the first row's product. Two different products that collide on a handle get -2, -3 and so on, so none is ignored. Handles are also slugified. It cannot know whether a product already exists in your store, so the overwrite choice stays yours.",
    demo: { kind: "rows", rows: [{ title: "Blue Mug", handle: "mug" }, { title: "Red Mug", handle: "mug" }, { title: "Green Mug", handle: "mug" }], field: "handle", expect: "mug-2" },
    related: ["invalid-handle", "options-are-not-unique", "ignored-line-no-product-data"],
    updated: UPDATED,
  },
  {
    slug: "ignored-line-no-product-data",
    title: "Fix: Ignored line, it did not contain product data",
    description:
      "Shopify ignores CSV lines that have a handle but no title. How to find rows with a missing product title, and when a blank Title is correct (variants).",
    heading: "“Ignored line … because it did not contain product data”",
    shopifyMessage: "Ignored line #-## because it did not contain product data",
    intro:
      "This message points at a line that has a handle but nothing Shopify can build a product from. It is usually a row where the title cell went missing, often because the supplier exports one header row per category, or because a spreadsheet filter hid rows while you edited.",
    causes: [
      "Shopify's own explanation is that the line has a handle but no product title. Title is required on the first row of every product.",
      "The confusing part is that a blank Title is perfectly correct on variant rows: Shopify's CSV reference says to skip the Title column for them. So the same empty cell is a bug on one row and right on the next, depending on whether an earlier row already introduced that handle.",
      "Supplier files that put the product name in a differently named column (name, product, article) trip over this too: if the title column is not mapped, every row arrives without one.",
    ],
    steps: [
      "Find the lines Shopify listed and check that the first row of each handle has a Title.",
      "If the line is a variant of a product you introduced earlier in the file, make sure it repeats that exact handle. Then a blank Title is fine.",
      "If the title lives in another column, copy or rename it so it ends up under Title.",
      "Re-import the affected products only, with overwrite on if they were partly created.",
    ],
    coverage: "helps",
    toolNote:
      "It finds the title column under its common names, and keeps blank titles only on genuine variant rows. A product whose title is missing everywhere gets the placeholder “Untitled Product”, so Shopify no longer ignores it. Replace those placeholders with real names before you publish, because the tool cannot invent them.",
    demo: { kind: "rows", rows: [{ title: "", handle: "mystery-item", sku: "X-1" }], field: "title", expect: "Untitled Product" },
    related: ["ignored-line-handle-already-exists", "choose-column-headings-window", "options-are-not-unique"],
    updated: UPDATED,
  },
  {
    slug: "missing-or-stray-quote-on-line",
    title: "Fix: Illegal quoting / Missing or stray quote on line",
    description:
      "Shopify rejects CSV files with a missing or stray quote. What breaks the quoting (smart quotes, descriptions with line breaks) and how to repair it safely.",
    heading: "“Illegal quoting on line” and “Missing or stray quote on line”",
    shopifyMessage: "Missing or stray quote on line",
    intro:
      "A single quotation mark in the wrong place can make a CSV unreadable, because quotes are what tell a parser where a cell starts and ends. One unclosed quote in row 40 swallows rows 41 to 4,000 into a single cell, and Shopify stops at the first line where the structure no longer makes sense.",
    causes: [
      "Shopify's page names the usual culprit: spreadsheet programs such as Excel can insert curly “smart” quotes, or an extra quote ends up in a line. A related message, “Illegal quoting on line”, points to an illegal character in the file or to the same missing or stray quote.",
      "Product descriptions are the most likely place. They are long, hand-written, full of inch marks (5\"), and often contain line breaks, all of which need correct quoting inside the cell.",
      "Editing a CSV by hand in a text editor, or exporting it with a tool that does not escape embedded quotes by doubling them, produces the same breakage.",
    ],
    steps: [
      "Open the file in a plain text editor, not a spreadsheet, and go to the line number from the message.",
      "Replace curly quotes with straight quotes and remove any stray quote on that line.",
      "Make sure every cell that contains a comma, a line break or a quote is wrapped in quotes, and that quotes inside a cell are doubled (\"\").",
      "Save as UTF-8 and import again. If the same message returns on a different line, repeat, or fix the source export instead.",
    ],
    coverage: "fixes",
    toolNote:
      "An unterminated quote is detected and dropped, so the following rows stay separate, and a warning tells you which row to double-check. Everything it writes is quoted correctly by construction, with embedded quotes doubled and line breaks inside quotes, so the cleaned file cannot contain a stray quote. Text that merely contains curly quotes is kept as it is.",
    demo: { kind: "csv", view: "rows", text: 'id,title,price\n1,Good mug,9.50\n2,"Broken title,12.00\n3,Next cup,7.00\n', expect: "next-cup" },
    related: ["invalid-csv-header-missing-headers", "encoding-broken-characters", "body-html-legacy-markup"],
    updated: UPDATED,
  },
  {
    slug: "invalid-csv-header-missing-headers",
    title: "Fix: Invalid CSV header: missing headers (Shopify)",
    description:
      "Shopify says 'Invalid CSV header: missing headers'. Check the first line for wrong names, wrong case, trailing spaces and an invisible byte-order mark.",
    heading: "“Invalid CSV header: missing headers” when importing products",
    shopifyMessage: "Invalid CSV header: missing headers",
    intro:
      "The import fails before it reads a single product, because the first line of the file does not look like the header row Shopify expects. The cause is usually invisible on screen: a space, a capital letter, or a character that your editor hides.",
    causes: [
      "Shopify's page says the first line does not match the required column headers and to check for extra spaces at the end of the first line. Headers are also case sensitive, so Handle is not the same as handle.",
      "A UTF-8 byte-order mark (BOM) is an invisible character some programs put at the very start of a file. It becomes part of the first column's name, so “Handle” is read as “﻿Handle” and no longer matches.",
      "Renamed or reordered headers from a supplier export (Name, SKU, Photo) never matched in the first place. Shopify also warns that if any header is missing, the import fails.",
    ],
    steps: [
      "Compare your first line against Shopify's current product CSV template, character for character, including capital letters.",
      "Delete trailing spaces and trailing commas on that line.",
      "Re-save the file as UTF-8 without a BOM, or retype the first header.",
      "Check that you did not add extra columns of your own: Shopify expects its own set.",
    ],
    coverage: "fixes",
    toolNote:
      "The tool writes the header row itself, with Shopify's exact names and capitalisation, and it reads your original headers under their common names, with spaces trimmed and a leading byte-order mark ignored. Columns it does not recognise are left out of the output rather than breaking the format.",
    demo: { kind: "csv", view: "headers", text: "﻿ Product Name ,Retail Price,Item Code\nBlue mug,9.50,MUG-1\n", expect: "Handle,Title" },
    related: ["choose-column-headings-window", "encoding-broken-characters", "semicolon-delimited-csv-one-column"],
    updated: UPDATED,
  },
  {
    slug: "choose-column-headings-window",
    title: "Fix: Shopify “Choose column headings” on CSV import",
    description:
      "Shopify opens a 'Choose column headings' window when CSV headers don't match its template. How to map supplier columns without editing by hand.",
    heading: "Shopify asks you to “Choose column headings” during import",
    shopifyMessage: null,
    intro:
      "You upload a supplier file and, instead of a preview, Shopify opens a window asking you to pick a heading for each column. It is a tell-tale sign that the file's first line is not in Shopify's vocabulary: the data may be fine, but nothing is labelled the way Shopify wants.",
    causes: [
      "Shopify's help center lists this window under the problems you may meet, and says it appears when the CSV headers are incorrect, with the correct ones then chosen from drop-down menus.",
      "Supplier systems name columns for their own purposes: Name instead of Title, Description instead of Body (HTML), Photo or Picture instead of Image Src, RRP instead of Variant Price, Article number instead of Variant SKU.",
      "Choosing headings by hand works for a handful of columns, but it is slow and easy to get wrong across a wide file, and you must repeat it for every new export.",
    ],
    steps: [
      "Look at your header row and write down which supplier column corresponds to each Shopify field you need.",
      "Rename the headers to Shopify's exact names, or choose the matching ones in the window when Shopify asks.",
      "Remove columns you do not need so the mapping stays short.",
      "Save the file as UTF-8 and import again; with correct headers the window no longer appears.",
    ],
    coverage: "fixes",
    toolNote:
      "Columns are recognised by their common names (title or name, description or body, images or photo, price or RRP, SKU or article, handle or slug) and written back under Shopify's exact headers, so the mapping window never has anything left to ask. Only those core fields are produced, so add anything else in Shopify.",
    demo: { kind: "csv", view: "rows", text: "Name,Description,Photo,RRP,Article\nBlue mug,<b>Nice</b> mug,https://cdn.example.com/m.jpg,9.50,MUG-1\n", expect: "blue-mug" },
    related: ["invalid-csv-header-missing-headers", "ignored-line-no-product-data", "semicolon-delimited-csv-one-column"],
    updated: UPDATED,
  },
  {
    slug: "image-download-error",
    title: "Fix: Error while trying to download the image (Shopify)",
    description:
      "Shopify says 'An error occurred while trying to download the image'. Check your image URLs: public, https, the final file, and no relative paths.",
    heading: "“An error occurred while trying to download the image”",
    shopifyMessage: "Validation failed: An error occurred while trying to download the image",
    intro:
      "Shopify does not read pictures from your CSV; it fetches every Image Src address itself, as if it were a visitor. When that visit fails, the product line fails with this message. So the question is never whether the file is valid, only whether Shopify's server can open the link.",
    causes: [
      "Shopify's page gives the immediate cause: the image file is missing. The address points at something that no longer exists, was moved, or was never uploaded to your supplier's server.",
      "The CSV reference sets the rules for Image Src: a publicly accessible URL, behind https, with no password protection, ending in the final file name rather than a thumbnail variant such as _thumb, _small or _medium.",
      "Supplier feeds often give file names without a host (wallet.jpg) or links that only work when you are logged in to the supplier's portal, and neither is reachable from outside.",
    ],
    steps: [
      "Open a few of the failing URLs in a private browser window. If they do not load without logging in, Shopify cannot load them either.",
      "Replace relative file names with full https addresses, and use the original image, not a _thumb or _small copy.",
      "If one product keeps failing, remove its image from that line, import, and add the picture in Shopify afterwards. Shopify's page suggests exactly this as a test.",
      "If the images are not reachable at all, host them yourself or ask the supplier for public links.",
    ],
    coverage: "helps",
    toolNote:
      "It normalises what it can: protocol-relative links (//cdn…) and www. addresses get https://, duplicate URLs are dropped, and entries that cannot be a web address (bare file names) are removed and counted, so they do not fail the import. It cannot check that a link is reachable, so test a few yourself.",
    demo: { kind: "rows", rows: [{ title: "Wallet", images: "//cdn.example.com/wallet-1.jpg|wallet-brown.jpg|www.example.com/wallet-2.jpg" }], field: "images", expect: "https://cdn.example.com/wallet-1.jpg" },
    related: ["getaddrinfo-image-url-error", "multiple-images-in-one-cell", "variant-image-position"],
    updated: UPDATED,
  },
  {
    slug: "getaddrinfo-image-url-error",
    title: "Fix: getaddrinfo nodename nor servname (Shopify CSV)",
    description:
      "'getaddrinfo: nodename nor servname provided, or not known' means a Shopify image URL is wrong. How to find the bad address and fix its format.",
    heading: "“getaddrinfo: nodename nor servname provided, or not known”",
    shopifyMessage: "Validation failed: getaddrinfo: nodename nor servname provided, or not known",
    intro:
      "This is the least friendly message on the list, and it has a simple meaning: when Shopify tried to turn the host name in one of your image links into a server address, there was no such host. It is a typo-level problem in a URL, not a problem with the picture.",
    causes: [
      "Shopify's page says the image URL is wrong, and the fix is to start it with http:// and make sure it is a publicly accessible direct link to the image.",
      "The usual sources: an address with no scheme at all (cdn.example.com/a.jpg), a protocol-relative link (//cdn.example.com/a.jpg), a stray space or comma inside the URL, or two URLs glued together in one cell.",
      "Less often the host itself is misspelled in the supplier's export, or points to an internal server name that only exists inside their network.",
    ],
    steps: [
      "Find the product the error refers to and read its Image Src character by character.",
      "Add the scheme (https://), remove spaces, and make sure one cell holds exactly one URL.",
      "Check that the host name is real by opening the link in a browser.",
      "If a whole supplier feed shares the problem, fix it in bulk rather than line by line.",
    ],
    coverage: "helps",
    toolNote:
      "Missing schemes are added (//host and www.host become https://), cells with several URLs are split into one row per image, and anything that cannot be a URL is dropped and counted. A misspelled or internal host name still looks like a valid address, so those you must fix at the source.",
    demo: { kind: "rows", rows: [{ title: "Poster", images: "www.example.com/poster-a.jpg;//cdn.example.com/poster-b.jpg" }], field: "images", expect: "https://www.example.com/poster-a.jpg" },
    related: ["image-download-error", "multiple-images-in-one-cell", "variant-image-position"],
    updated: UPDATED,
  },
  {
    slug: "options-are-not-unique",
    title: "Fix: Validation failed: options are not unique",
    description:
      "Shopify rejects products whose variants repeat the same option values. Why rows that share a handle collide, and how Option1 and Option2 must be filled.",
    heading: "“Validation failed: options are not unique”",
    shopifyMessage: "Validation failed: options are not unique",
    intro:
      "Variants are where a flat supplier list and Shopify's product model really disagree. Shopify wants every variant of a product to be distinguishable by its option values, and this message means that two of your rows are, as far as it can tell, the same variant.",
    causes: [
      "Shopify's page describes it as a product with duplicate option combinations, such as two medium black variants, and says the same handle may also appear elsewhere in the CSV with the same options.",
      "Because rows that share a handle are read as variants of one product, two different products accidentally given one handle end up looking like one product with repeated variants.",
      "Variant columns left empty are a related trap: the CSV reference notes that including variant columns such as SKU or weight without Option1 Name and Option1 Value creates a new default variant and deletes the existing ones.",
    ],
    steps: [
      "List the rows that share a handle and check that each has a different combination of Option1, Option2 and Option3 values.",
      "Where two rows are genuinely the same variant, delete one. Where they are different products, give them different handles.",
      "For a product with one variant, use the option name Title and the value Default Title.",
      "Re-import the affected products and check the variant count in Shopify.",
    ],
    coverage: "helps",
    toolNote:
      "It reads variant columns in the usual layouts (Option1 Name and Option1 Value, WooCommerce-style Attribute columns, or plain Size and Colour columns) and writes Option1, Option2 and Option3 Name and Value the way Shopify expects: names on the product's first row only, a value on every variant, one handle per product and the Title blank on variant rows. A plain Size or Style column only becomes an option if it really tells the variants of a product apart. It also lists duplicate option combinations, variants with a missing value and variant rows that are not together, because it cannot know which of two identical variants you want to keep: those you still fix yourself. It removes the most common cause of the collision on its own: two different products sharing one handle.",
    demo: {
      kind: "csv",
      view: "options",
      text: "Handle,Title,size,color,Variant SKU\nclassic-tee,CLASSIC TEE,S,NAVY,TEE-S-NAVY\nclassic-tee,,M,NAVY,TEE-M-NAVY\nclassic-tee,,S,RED,TEE-S-RED\n",
      expect: "classic-tee | Classic Tee | Size | S | Color | Navy",
    },
    related: ["ignored-line-handle-already-exists", "ignored-line-no-product-data", "invalid-handle"],
    updated: UPDATED,
  },
  {
    slug: "price-cant-be-blank",
    title: "Fix: Validation failed: price can't be blank (Shopify)",
    description:
      "Shopify rejects CSV lines without a price. Why prices come out empty after a supplier export, and how to tell a real blank from a price Shopify can't read.",
    heading: "“Validation failed: price can't be blank”",
    shopifyMessage: "Validation failed: price can't be blank",
    intro:
      "A price is the one number a product cannot do without, so Shopify stops at any line where that cell is empty. The hard part is that the cell often looks full in the spreadsheet: it just does not hold a price.",
    causes: [
      "Shopify's page states the cause plainly: the line has no price. The fix is to add one.",
      "Placeholders count as no price. Supplier files fill empty cells with N/A, null, a dash or “call for price”, and none of those is a number.",
      "A price in the wrong column also reads as blank: after a column shift the amount sits under SKU or Compare At Price while Variant Price stays empty. Wholesale feeds also often carry prices in a separate file you have to merge in.",
    ],
    steps: [
      "Filter the Variant Price column for empty cells and for anything that is not a plain number.",
      "Fill in the missing prices, or merge them in from the price list by SKU.",
      "Replace placeholders (N/A, -, null) with a real value or remove those products from this import.",
      "Re-import and spot-check a few lines in Shopify's product list.",
    ],
    coverage: "helps",
    toolNote:
      "Placeholders such as N/A, null and dashes are treated as empty, and real prices in many formats are turned into plain numbers, so a price that merely looked blank to Shopify now imports. A product that truly has no price in your file stays blank, because the tool cannot know what to charge.",
    demo: { kind: "rows", rows: [{ title: "Mug", price: "USD 19.9" }, { title: "Cup", price: "N/A" }, { title: "Bowl", price: "" }], field: "price", expect: "19.90" },
    related: ["price-format", "choose-column-headings-window", "ignored-line-no-product-data"],
    updated: UPDATED,
  },
  {
    slug: "price-format",
    title: "Shopify CSV price format: remove symbols and commas",
    description:
      "Variant Price must be a bare number like 9.99. Turn $1,299.00, 1.299,00 EUR and 1 299,00 Kč into Shopify's format without breaking the decimals.",
    heading: "Shopify CSV price format: what Variant Price must look like",
    shopifyMessage: null,
    intro:
      "Prices are where regional habits collide with a fixed format. A supplier in Prague writes 1 299,00 Kč, a supplier in Texas writes $1,299.00, and both mean the same thing, which Shopify can only read if you hand it the digits and a dot: 1299.00.",
    causes: [
      "Shopify's CSV reference asks for the numeric amount only, with no currency symbol, and gives 9.99 as the example. Anything else in the cell is at best ignored.",
      "The decimal and thousands separators are swapped between countries. 1.299 is one thousand two hundred ninety-nine in one place and just over one in another, which is why a blind find-and-replace of commas is dangerous.",
      "Currency symbols and codes (€, Kč, USD) and non-breaking spaces used as thousands separators are invisible traps; Excel may also silently turn prices into dates or round them when it opens the file.",
    ],
    steps: [
      "Decide which separator is the decimal one in your file by looking at a price with cents, such as 24,50 or 24.50.",
      "Remove currency symbols, codes and spaces, and remove the thousands separator.",
      "Use a dot as the decimal separator and keep two decimals: 1299.00.",
      "Keep the column as text if you reopen the file in a spreadsheet, so it does not reinterpret the numbers.",
    ],
    coverage: "fixes",
    toolNote:
      "It reads the common notations, including $1,299.00, 1.299,00 EUR, 89,90 € and 1 299,00 Kč, decides which separator is the decimal one, and writes a plain number with two decimals. Negative or unreadable prices are left empty rather than guessed.",
    demo: { kind: "rows", rows: [{ title: "A", price: "$1,299.00" }, { title: "B", price: "1.299,00 EUR" }, { title: "C", price: "89,90 €" }, { title: "D", price: "1 299,00 Kč" }], field: "price", expect: "1299.00" },
    related: ["price-cant-be-blank", "semicolon-delimited-csv-one-column", "encoding-broken-characters"],
    updated: UPDATED,
  },
  {
    slug: "variant-image-position",
    title: "Shopify CSV Image Position and Variant Image errors",
    description:
      "How Image Position, Variant Image and extra image rows work in a Shopify product CSV, why images end up missing or out of order, and how to lay them out.",
    heading: "Image Position and Variant Image in a Shopify product CSV",
    shopifyMessage: null,
    intro:
      "Product pictures are the part of a CSV that does not look like a spreadsheet at all. A product with five photos takes five rows, only some columns are filled on the extra rows, and a variant can point at one of them. Get the layout slightly wrong and the pictures go missing, repeat, or land in the wrong order.",
    causes: [
      "Shopify's reference describes the pieces: Image Src holds a public URL, Image Position is a number that sets the display order starting from 1, and Variant Image holds the URL of the picture a variant should show, which must be a working image URL.",
      "Each additional image is its own row that repeats the product handle. The extra rows need the handle, the image address and, if you want control, the position; variant data on those rows can confuse the import.",
      "Common slips: all images numbered 1, positions that skip numbers, several URLs in one cell, and a Variant Image address that is not one of the product's Image Src addresses, so it matches nothing. Sorting the file in a spreadsheet can also separate image rows from their product.",
    ],
    steps: [
      "Give each product one row for the product data and its first image, then one row per extra image, all with the same handle.",
      "On extra image rows, fill only Handle, Image Src and Image Position, numbered 2, 3 and so on in the order you want them shown.",
      "Fill Variant Image only on variant rows, with a URL that also appears in Image Src.",
      "Do not sort or filter the file after building it, or keep the handle column together with the image rows.",
    ],
    coverage: "helps",
    toolNote:
      "It turns an image cell holding several URLs into one row per image, in the original order, each with the product's handle, and removes duplicates and unusable entries. It does not write Image Position or Variant Image columns: Shopify ordering then follows the rows, and you add a Variant Image column yourself if a variant needs its own picture.",
    demo: { kind: "rows", rows: [{ title: "Lamp", images: "https://cdn.example.com/lamp-1.jpg|https://cdn.example.com/lamp-2.jpg|https://cdn.example.com/lamp-3.jpg" }], field: "images", expect: "lamp-2.jpg" },
    related: ["multiple-images-in-one-cell", "image-download-error", "options-are-not-unique"],
    updated: UPDATED,
  },
  {
    slug: "invalid-handle",
    title: "Shopify invalid handle in CSV: what's allowed, how to fix",
    description:
      "A Shopify handle can contain letters, dashes and numbers, and no spaces. How to fix handles with spaces, capitals, accents and symbols across a whole CSV.",
    heading: "Invalid handles in a Shopify CSV: what is allowed and how to fix them",
    shopifyMessage: null,
    intro:
      "The handle is the end of the product's web address, so it has to behave like one. Supplier files, though, treat it as just another text column, and you end up with “Blue T-Shirt (Large)!”, accented Czech words, or no handle at all. Here is what Shopify accepts and how to clean a column of them at once.",
    causes: [
      "Shopify's CSV reference puts it in one line: a valid URL handle can contain letters, dashes and numbers, but it cannot contain any spaces. It is also the unique identifier for each product.",
      "Titles copied into the handle column keep their capitals, spaces, brackets, ampersands and accents. Accented letters are the awkward ones, because č or ß need turning into plain letters, not deleting.",
      "Very long titles make very long handles, and a handle that is slightly different on each export causes products to be created twice instead of updated.",
    ],
    steps: [
      "Lower-case the handle and replace spaces and punctuation with a single dash.",
      "Turn accented letters into their plain forms (č to c, ß to ss) and spell out & as and.",
      "Trim dashes from both ends and keep the length reasonable.",
      "Check the result for duplicates, because two titles can collapse to the same handle.",
    ],
    coverage: "fixes",
    toolNote:
      "Every handle is rebuilt as a clean slug: lower case, accents transliterated, & written as and, symbols and spaces turned into single dashes. If your file has no handle column, it is generated from the title (falling back to SKU, id or the row number), and duplicates are made unique.",
    demo: { kind: "rows", rows: [{ title: "Blue Tee", handle: "Blue T-Shirt (Large)!" }, { title: "Čokoláda & Mléko", handle: "" }], field: "handle", expect: "blue-t-shirt-large" },
    related: ["ignored-line-handle-already-exists", "title-all-caps", "encoding-broken-characters"],
    updated: UPDATED,
  },
  {
    slug: "encoding-broken-characters",
    title: "Shopify CSV broken characters: fix encoding to UTF-8",
    description:
      "Strange symbols like Ã© or � after a Shopify import mean the CSV isn't UTF-8. How Excel and old exports cause it, and how to convert the file correctly.",
    heading: "Random or strange characters after a Shopify CSV import",
    shopifyMessage: null,
    intro:
      "You see “Café” turn into “Caf�” or “CafÃ©”, a euro sign vanish, a Czech name arrive as nonsense. The words in the file are fine; the problem is that two programs disagree on which numbers stand for which letters. Shopify reads UTF-8, so a file saved any other way is misread from the first accented character on.",
    causes: [
      "Shopify's help center states that the CSV must be UTF-8 and lists random or strange characters as the symptom of a file that is not, with the cure of re-saving it as UTF-8 in a text editor. It also says UTF-8 is needed so that quotes and apostrophes come out right.",
      "Excel on many systems saves “CSV” in a legacy Windows encoding rather than UTF-8, and older supplier systems do the same. Windows-1252 covers Western European letters; Central European text such as Czech and Polish was often saved in yet another encoding, Windows-1250, and Cyrillic text in Windows-1251.",
      "The damage is permanent if a wrongly decoded file is saved again as UTF-8, because the garbage characters are then stored as if they were the text.",
    ],
    steps: [
      "Do not edit and re-save the broken file. Go back to the original export.",
      "Open it in a text editor that lets you choose the encoding, pick the one the file was really saved in, and check the letters look right.",
      "Save it as UTF-8 and import that.",
      "If you only have a spreadsheet, use the “CSV UTF-8” export option rather than plain “CSV”.",
    ],
    coverage: "fixes",
    toolNote:
      "The file's bytes are inspected: UTF-8 (with or without a byte-order mark) and UTF-16 are read as they are. A file that is not valid UTF-8 is read as whichever legacy encoding makes the most sense of its letters (Windows-1252, 1250 or 1251, ISO-8859-2 or ISO-8859-15), and the result is always UTF-8. The encoding it settled on is shown above the preview with a menu to pick another one, which re-reads the same file. One honest limit: a short file with only a few accented letters can fit more than one encoding, and then you are told it was a guess and which others would also fit.",
    demo: { kind: "bytes", text: "Žlutý kůň – příliš černé boty, 249 Kč", encoding: "windows-1250", expect: "Žlutý kůň – příliš černé boty, 249 Kč" },
    related: ["invalid-csv-header-missing-headers", "semicolon-delimited-csv-one-column", "missing-or-stray-quote-on-line"],
    updated: UPDATED,
  },
  {
    slug: "csv-file-too-large",
    title: "Shopify CSV too large: the 15 MB import limit",
    description:
      "Shopify's product CSV import accepts files up to 15 MB. Why supplier files get that big, how bloated descriptions inflate them, and how to split the rest.",
    heading: "Shopify CSV import fails because the file is too large",
    shopifyMessage: null,
    intro:
      "The upload sits there, times out, or is refused, and the file is “only” a few thousand products. Shopify caps what a single import can be, and the culprit is rarely the number of products: it is how much text each row carries.",
    causes: [
      "Shopify's import page states that the CSV cannot be larger than 15 MB, and that if an upload fails or times out you should split the file into smaller ones and upload each separately.",
      "Descriptions dominate file size. Supplier HTML is padded with inline styles, font tags, empty paragraphs and Word or Excel leftovers, which can turn a two-sentence description into several kilobytes, repeated for every row.",
      "Image rows add up too: a product with eight pictures is nine lines, each repeating the handle.",
    ],
    steps: [
      "Strip the formatting noise from descriptions first. It often shrinks a file more than splitting does.",
      "Remove columns you do not need.",
      "If the file is still over the limit, split it by rows into several files, keeping all rows of one product together and repeating the header line in each.",
      "Import the parts one after another and check the results of each.",
    ],
    coverage: "helps",
    toolNote:
      "It writes only the six core columns and replaces inline-styled, font-tagged HTML with plain paragraphs, which usually makes the file much smaller. It does not split a file into parts, so for a very large catalogue cut the original into batches before cleaning each.",
    demo: {
      kind: "rows",
      rows: [{ title: "Sofa", description: '<div style="font-family:Arial;font-size:12px;color:#333333;margin:0cm 0cm 0pt"><font face="Verdana" size="2" color="#111111"><span style="font-size:10pt"><span class="MsoNormal"><o:p>Three-seat sofa with a solid beech frame.</o:p></span></span></font></div>' }],
      field: "description",
      sizes: true,
      expect: "<p>Three-seat sofa with a solid beech frame.</p>",
    },
    related: ["body-html-legacy-markup", "multiple-images-in-one-cell", "encoding-broken-characters"],
    updated: UPDATED,
  },
  {
    slug: "semicolon-delimited-csv-one-column",
    title: "CSV opens in one column? Fix the semicolon separator",
    description:
      "If a supplier CSV opens in one column, it uses semicolons or tabs, not commas. Why European Excel does this and how to import the file into Shopify.",
    heading: "CSV opens in one column: semicolon and tab separators",
    shopifyMessage: null,
    intro:
      "You double-click the file and every product is crammed into column A, or Shopify wants you to choose a heading for something that looks like one giant column. The data is intact. The file just uses a different character between cells than the program expects.",
    causes: [
      "The CSV format only says “values separated by a separator”, and the separator is a regional choice. Where the comma is the decimal mark (the Czech Republic, Germany, France and many others), spreadsheets default to semicolons, so a file made there looks wrong in a program set up for commas.",
      "Shopify expects columns separated by commas, with the header on the first line, and its reference says to check that your spreadsheet's export settings really use commas.",
      "Tab-separated exports (TSV) and “text” exports behave the same way. Prices such as 29,50 then add a second trap, because the comma inside a number can be mistaken for a separator once the semicolons are replaced.",
    ],
    steps: [
      "Find out the real separator by opening the file in a text editor and looking at the first line.",
      "Import the file into your spreadsheet with that separator chosen, not by double-clicking.",
      "Export again as comma-separated UTF-8, and make sure numbers with decimal commas are quoted or converted first.",
      "Open the result in a text editor once to confirm that commas separate the cells.",
    ],
    coverage: "fixes",
    toolNote:
      "Comma, semicolon and tab are detected automatically and read correctly, including decimal commas such as 29,50 inside a semicolon file. The pipe character is deliberately not treated as a column separator, because suppliers use it to join image links inside a cell. The output is always comma-separated.",
    demo: { kind: "csv", view: "rows", text: "id;title;price\n1;Blue mug;29,50\n2;Red cup;1 299,00\n", expect: "1299.00" },
    related: ["invalid-csv-header-missing-headers", "choose-column-headings-window", "price-format"],
    updated: UPDATED,
  },
  {
    slug: "title-all-caps",
    title: "Fix ALL CAPS product titles in a Shopify CSV",
    description:
      "Supplier feeds love ALL CAPS titles. How to convert them to proper Title Case without ruining USB-C, 750ml, XL and other acronyms and units.",
    heading: "ALL CAPS product titles: converting a CSV to Title Case safely",
    shopifyMessage: null,
    intro:
      "Nothing breaks if you import “WIRELESS BLUETOOTH HEADPHONES NOISE CANCELLING”, but your store will look like a clearance warehouse, shout at customers in search results, and read worse in the Google listing. This is a quality problem rather than an import error, and the fix is more subtle than it looks.",
    causes: [
      "Many supplier and ERP systems store names in capitals because it is one rule that works for every language and every system. The export then carries them straight into your title column.",
      "The obvious fix, capitalising every word, damages what should stay as it is: USB-C becomes Usb-C, 750ml becomes 750Ml, XL becomes Xl, and words such as “of” and “the” get capitals they should not have.",
      "All-lower-case titles are the same problem in reverse, and a mixed-case title like “iPhone 15 Pro Case” is already right and must be left alone.",
    ],
    steps: [
      "Convert only titles that are entirely upper case (or entirely lower case); leave mixed-case titles untouched.",
      "Capitalise each word except short joining words (of, the, and) in the middle of the title.",
      "Keep acronyms (USB, LED, HDMI), sizes (XL) and model codes (RTX3080) in capitals, and units in their normal form (750ml, 2kg).",
      "Read a sample of the result, because names and brands will always need an occasional manual touch.",
    ],
    coverage: "fixes",
    toolNote:
      "Titles that are all caps or all lower case are converted to Title Case with an acronym and unit list, so USB-C, LED, XL, 750ml and RTX3080 survive, small words stay lower case, and well-formed titles such as iPhone 15 Pro Case are not touched. Brand names it does not know come out as plain Title Case.",
    demo: { kind: "rows", rows: [{ title: "USB-C CHARGING CABLE 2M 100W LED" }, { title: "STAINLESS STEEL WATER BOTTLE 750ML" }, { title: "LORD OF THE RINGS BOX SET" }], field: "title", expect: "USB-C Charging Cable 2m 100W LED" },
    related: ["body-html-legacy-markup", "invalid-handle", "ignored-line-no-product-data"],
    updated: UPDATED,
  },
  {
    slug: "body-html-legacy-markup",
    title: "Clean legacy HTML in Shopify product descriptions",
    description:
      "Supplier descriptions arrive with font tags, inline styles and Word junk that fight your theme. What to strip, what to keep, and how to clean a whole CSV.",
    heading: "Legacy HTML in product descriptions: what to strip from a Shopify CSV",
    shopifyMessage: null,
    intro:
      "Open a supplier description in your store and it may be in a different font, size and colour from everything around it, or the layout breaks on a phone. The text is fine. The HTML wrapped around it was written for another website, another decade, or Microsoft Word, and it overrides your theme.",
    causes: [
      "Descriptions in the Body (HTML) column are published as written. Anything in them (font tags, inline style attributes, class names from a pasted Word document, empty paragraphs, tables used for layout) ends up in your product page.",
      "Pasting from Word or Excel adds conditional comments and namespaced tags such as o:p that mean nothing outside those programs. Line breaks typed as two <br> tags and non-breaking spaces make spacing uneven.",
      "ALL CAPS descriptions are the text-level version of the same problem: they shout in every theme.",
    ],
    steps: [
      "Remove font and span tags, inline styles and classes, and keep the text inside them.",
      "Turn div blocks and double line breaks into proper paragraphs, and keep real lists, bold and italic.",
      "Delete empty paragraphs, comments and Word or Excel leftovers.",
      "Preview a few products in your theme, because tables and embedded media may need individual attention.",
    ],
    coverage: "fixes",
    toolNote:
      "Font, span and div tags, inline styles, classes, comments, scripts and Word leftovers are removed, blocks become clean paragraphs, lists keep their structure, bold and italic are kept, entities are decoded and the text is escaped safely. Descriptions written entirely in capitals are converted to sentence case, with acronyms and units preserved.",
    demo: { kind: "rows", rows: [{ title: "Tee", description: '<div style="color:#333"><font face="Verdana">100% <b>organic cotton</b> tee.</font><br><br>Pre-shrunk, <span class="hl">machine washable</span>.</div>' }], field: "description", expect: "<p>100% <strong>organic cotton</strong> tee.</p>" },
    related: ["title-all-caps", "csv-file-too-large", "missing-or-stray-quote-on-line"],
    updated: UPDATED,
  },
  {
    slug: "multiple-images-in-one-cell",
    title: "Multiple images in one CSV cell: Shopify needs rows",
    description:
      "Shopify reads one image per row, not several URLs in a cell. How to split pipe, comma and semicolon separated image lists into the extra rows it expects.",
    heading: "Several image URLs in one cell: how Shopify expects them",
    shopifyMessage: null,
    intro:
      "Your supplier gave you one tidy cell per product with all the pictures inside, separated by pipes or commas. It is neat for them and useless for Shopify, which will take the whole string as a single address, find nothing at it, and either lose the pictures or fail the line.",
    causes: [
      "Shopify's CSV reference describes Image Src as a single URL, and a product with several images uses further rows that repeat the handle, one image per row, up to 250 images per product. There is no list syntax inside a cell.",
      "Feeds join the pictures with whatever character the exporter favours: a pipe, a semicolon, a comma, a space or a line break. A comma is the worst choice, because it is also what separates the CSV columns.",
      "Because the extra rows must repeat the handle, splitting by hand means inserting rows, copying handles and keeping the order, which is slow and easy to break once the file is sorted.",
    ],
    steps: [
      "Keep the first image on the product row.",
      "Add one new row per further image directly below it, with the same handle and only the image URL filled in.",
      "Make sure every URL is complete, public and https.",
      "Check the product order afterwards: do not sort the file, or the image rows lose their product.",
    ],
    coverage: "fixes",
    toolNote:
      "Cells with pipes, semicolons, commas followed by a link, spaces or line breaks are split in their original order. The first URL stays on the product row and each further one becomes its own row with the product's handle. Duplicates and non-URL fragments are removed.",
    demo: { kind: "rows", rows: [{ title: "Backpack", images: "https://cdn.example.com/bag-1.jpg|https://cdn.example.com/bag-2.jpg; https://cdn.example.com/bag-3.jpg, https://cdn.example.com/bag-4.jpg" }], field: "images", expect: "bag-4.jpg" },
    related: ["variant-image-position", "image-download-error", "getaddrinfo-image-url-error"],
    updated: UPDATED,
  },
];

export function getGuide(slug: string): ImportErrorGuide | undefined {
  return IMPORT_ERRORS.find((guide) => guide.slug === slug);
}
