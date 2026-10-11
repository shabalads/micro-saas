// src/site/faq.ts
//
// The landing page FAQ. Plain strings, because the same text is rendered on the page and published as FAQPage
// structured data, and the two must match. Every claim here describes what the code really does.

import { FREE_ROW_LIMIT, PRICE_LABEL, taxNote } from "../app/utils/pricing";
import { guaranteeSentence } from "./legal";

export interface FaqItem {
  question: string;
  answer: string;
}

export const FAQ: FaqItem[] = [
  {
    question: "Are my files uploaded anywhere?",
    answer:
      "No. Your CSV is opened and cleaned inside your own browser, on your own device, and its contents are never uploaded to our servers. " +
      "We log only anonymous usage counts: the number of rows, the file size, how long cleaning took, how many fixes were made, and a one-way hash of the file name (never the name itself and never any data from inside the file). " +
      "If you start a purchase, a copy of your file is kept in your browser's own storage so that it survives the trip to the payment page. It stays on your device and is removed once your download has been delivered. " +
      "If you claim the free first big file we also keep a one-way hash of your email address and a random id of your browser, so that it stays one per person; never your file.",
  },
  {
    question: "What does it actually fix?",
    answer:
      "ALL CAPS and all-lowercase product titles (acronyms such as USB-C and units such as 750ml are kept; you can also choose sentence case or keep titles and vendors as supplied), legacy HTML in descriptions (font tags, inline styles, divs, Word and Excel leftovers), ALL CAPS descriptions, " +
      "missing or invalid handles, several image URLs crammed into one cell, prices written like $1,299.00 or 1 299,00 Kč, stray whitespace and hidden characters, and rows that repeat a handle for variants. " +
      "Variants get proper Option1, Option2 and Option3 Name and Value columns when your file has Option, Attribute, Size or Color columns, with one handle per product and the product-level fields only on its first row. " +
      "It also copes with the usual file problems: semicolon or tab separators, a byte-order mark, unclosed quotes, and files saved in an old Windows or ISO encoding instead of UTF-8.",
  },
  {
    question: `How does the ${FREE_ROW_LIMIT}-row rule work?`,
    answer:
      `Files with ${FREE_ROW_LIMIT} rows or fewer are free: clean and download the complete file. For a bigger file you get a free before/after preview of the first ${FREE_ROW_LIMIT} rows, ` +
      `and the complete cleaned file costs a one-time ${PRICE_LABEL}, ${taxNote()}, except for your first big file, which is free (see below). Nothing beyond the preview is cleaned until you unlock it. A payment covers the one file it was made for.`,
  },
  {
    question: "Is the first big file really free?",
    answer:
      `Yes. The first time you load a file with more than ${FREE_ROW_LIMIT} rows, choose "Get your first big file free", enter your email address and the complete cleaned file is unlocked, with no card and no payment. It is one free file per person: ` +
      "to keep it to one we store a one-way hash of your email address (the address itself is not stored) and a random id of your browser, which also lets you download the same file again later. " +
      "A box for occasional product updates is there too: it is optional, unticked, and the free file does not depend on it. If the free file has already been used with that email or in that browser, the page says so and you can unlock the file with the one-time payment instead.",
  },
  {
    question: "How are payments handled?",
    answer:
      "Payment is taken by Stripe on its own secure checkout page. Your card details never reach us. Stripe works out the tax for your billing country and shows the total before you pay, and sends you a receipt. " +
      "Your complete file is available to download as soon as the payment is confirmed.",
  },
  {
    question: "I paid but closed the tab, or lost my download. What now?",
    answer:
      "Reopen the site on the same device and your file is handed back automatically, because a copy waits in your browser's storage. On another device, use the Recover page: enter the email address from your Stripe receipt, " +
      "then upload the same file again and its complete download unlocks with no second payment.",
  },
  {
    question: "Can I get a refund?",
    answer:
      `Yes. ${guaranteeSentence()} Just email us with your receipt reference. ` +
      "That promise is separate from the legal 14-day right of withdrawal: because the complete file is a digital download delivered immediately, at checkout you are asked to request immediate delivery and to acknowledge that you then lose that statutory right. " +
      "Your other statutory rights are not affected either: if the file cannot be delivered or does not conform, you are entitled to a remedy. See the refund policy for the details.",
  },
  {
    question: "Which files can I upload?",
    answer:
      "CSV, TSV or TXT files up to 25 MB, separated by commas, semicolons or tabs, encoded as UTF-8, UTF-16 or an older code page (Windows-1250, 1251 or 1252, ISO-8859-2 or ISO-8859-15). The encoding is detected for you and shown above the preview, with a menu to pick another one if the letters look wrong. Columns are recognised by name (title or name, description or body, images, price, SKU or product code, handle, id, vendor or brand, category, tags, stock, EAN, currency, weight, Option1 Name and Value, Size, Color and common variants of them, in English, Czech, Slovak, Polish, German, French and Spanish), so you do not need to rename anything first.",
  },
  {
    question: "Will Shopify accept the result?",
    answer:
      "The output uses Shopify's documented column names (Handle, Title, Body (HTML), Image Src, Image Position, Variant Price, Variant SKU and Status) with one image per row, plus Vendor, Type (from your category), Tags, Variant Barcode, Variant Grams and Variant Inventory Tracker and Qty when your file has those columns, and Option1, Option2 and Option3 Name and Value when it has variant columns. Products arrive as drafts unless you tick \"Import as active\". It does not create compare-at prices, SEO fields or metafields, so add those in Shopify. " +
      "As with any import, try a small batch first and keep a backup of your store data.",
  },
];
