// src/site/demo-data.ts
//
// Messy sample products for the landing page. They are cleaned by the real sanitizer when the page is built, so the
// "after" shown to visitors is what the tool actually produces, never a hand-written mock-up.
// (The example.com addresses are the reserved example domain, used here as inert sample data, not as site URLs.)

import type { RawSupplierRow } from "../app/types/csv";

export const DEMO_ROWS: RawSupplierRow[] = [
  {
    id: "1001",
    title: "  BLUE   T-SHIRT 123  ",
    description:
      '<div style="font-family:Arial;color:#333"><font face="Verdana" size="2">100% <b>organic cotton</b> tee.</font><br><br>Pre-shrunk, <span class="hl">machine washable</span>.</div>',
    images:
      "https://cdn.example.com/tee-blue-front.jpg|https://cdn.example.com/tee-blue-back.jpg|https://cdn.example.com/tee-blue-detail.jpg",
    price: "$24.50",
    sku: "TSH-BLU-123 ",
  },
  {
    id: "1002",
    title: "WIRELESS BLUETOOTH HEADPHONES  NOISE CANCELLING",
    description:
      '<p style="MARGIN: 0cm 0cm 0pt" class="MsoNormal"><span style="FONT-SIZE: 10pt"><o:p>OVER-EAR HEADPHONES WITH 30H BATTERY AND USB-C CHARGING.</o:p></span></p>',
    images: "https://cdn.example.com/hp-black.jpg, https://cdn.example.com/hp-black-side.jpg",
    price: "89,90 €",
    sku: "HP-NC-30",
  },
  {
    id: "1003",
    title: "CERAMIC COFFEE MUG 350ML SET OF 2",
    description: "Hand-painted&nbsp;mugs &amp; gift box.<br>Dishwasher &amp; microwave safe.",
    images: "//cdn.example.com/mug-1.jpg;//cdn.example.com/mug-2.jpg",
    price: "1 299,00 Kč",
    sku: "MUG-350-2PK",
  },
];
