// src/app/utils/header-aliases.ts
//
// What suppliers call their columns, per column this tool understands. This is the data file: to teach the importer a new
// name, add it to the right list (header-match.ts does the matching). Names are compared without regard to case, accents or
// punctuation ("Qty. in Stock", "qty-in-stock" and "QTY IN STOCK" are one name), first exactly, then as part of a longer
// header ("Wholesale Price (USD)" contains "wholesale price"), then by similarity (a misspelling such as "Descripton").
//
// When a file has several columns that fit one list, the name listed FIRST wins (so a file with "SKU" and "Code" uses "SKU").
// Every name is written the way a person would write it; spaces are free. English first, then Czech, Slovak, Polish, German,
// French and Spanish.

import type { RawSupplierRow } from "../types/csv";

/** The columns a header can be mapped to (the rest of RawSupplierRow is filled in from the cells themselves). */
export type ColumnKey = Exclude<keyof RawSupplierRow, "options" | "weightUnit" | "firstCell" | "sourceRow">;

export const HEADER_ALIASES: Record<ColumnKey, string[]> = {
  id: ["id", "product id", "item id", "supplier id", "supplier product id", "external id", "ref", "reference"],

  title: [
    "title", "name", "product name", "product title", "item name", "item title", "product",
    "nazev", "nazev produktu", "nazev zbozi", "produkt", "nazov", "nazov produktu", "nazwa", "nazwa produktu",
    "bezeichnung", "produktname", "artikelname", "nom", "nom du produit", "nombre", "nombre del producto",
  ],

  description: [
    "description", "desc", "body", "body html", "long description", "product description", "details", "html",
    "popis", "popis produktu", "dlouhy popis", "opis", "opis produktu", "beschreibung", "produktbeschreibung", "descripcion", "descriptif",
  ],

  images: [
    "images", "image", "image url", "image urls", "image src", "image links", "photos", "photo", "pictures", "picture", "img", "img url", "gallery",
    "obrazek", "obrazky", "url obrazku", "foto", "fotka", "fotografie", "obrazok", "zdjecie", "zdjecia", "obraz", "bild", "bilder", "bild url", "imagen", "imagenes",
  ],

  // The retail price: what the customer pays. It becomes Variant Price.
  price: [
    "price", "retail price", "rrp", "msrp", "retail", "list price", "sell price", "selling price", "sale price", "unit price", "variant price",
    "cena", "prodejni cena", "cena prodejni", "doporucena cena", "koncova cena", "cena s dph", "cena sprzedazy", "cena detaliczna", "cena brutto",
    "preis", "verkaufspreis", "vk preis", "ladenpreis", "uvp", "prix", "prix de vente", "prix public", "precio", "precio de venta", "pvp",
  ],

  // What the shop pays. It becomes Cost per item, and never Variant Price.
  cost: [
    "cost", "cost price", "cost per item", "wholesale price", "wholesale", "trade price", "net price", "buy price", "dealer price", "purchase price", "unit cost", "supplier price",
    "nakupni cena", "velkoobchodni cena", "vo cena", "cena velkoobchod", "cena nakup", "dodavatelska cena", "nakupna cena", "velkoobchodna cena",
    "cena zakupu", "cena hurtowa", "cena nabycia", "einkaufspreis", "ek preis", "haendlerpreis", "grosshandelspreis",
    "prix de gros", "prix d achat", "prix achat", "prix revendeur", "precio mayorista", "precio de compra", "precio de coste", "costo",
  ],

  // The first alias that matches wins, so a file with both "SKU" and "Product code" gets its SKU from "SKU".
  sku: [
    "sku", "variant sku", "item code", "part number", "part no", "article number", "article", "code",
    "katalogove cislo", "cislo zbozi", "objednaci cislo", "artikelnummer", "art nr",
    "product code", "kod produktu", "kod", "kod zbozi",
  ],

  handle: ["handle", "slug", "url handle", "url key"],

  productCode: ["parent sku", "parent code", "parent id", "parent", "sku parent", "group id", "group code", "product group id", "item group id", "item group", "model code", "model", "style id", "style code", "variant group", "kod skupiny"],

  vendor: [
    "vendor", "brand", "manufacturer", "supplier", "vendor name", "brand name",
    "vyrobce", "znacka", "dodavatel", "vyrobca", "producent", "marka", "hersteller", "marke", "fabricant", "marca", "fabricante",
  ],

  // The product type: becomes Type.
  category: [
    "category", "categories", "product type", "type", "product category", "department", "dept", "product group", "class",
    "kategorie", "kategoria", "typ produktu", "typ", "oddeleni", "skupina zbozi", "druh", "dzial", "grupa produktow",
    "abteilung", "warengruppe", "produktgruppe", "produkttyp", "categoria", "categorie", "rayon", "departement", "famille", "departamento", "familia", "tipo de producto",
  ],

  tags: ["tags", "tag", "keywords", "stitky", "stitek", "klicova slova", "tagi", "schlagworter", "etiquetas", "etiquettes"],

  // The quantity in stock: becomes Variant Inventory Qty (and switches the tracker on).
  stock: [
    "qty in stock", "stock qty", "stock quantity", "quantity", "qty", "on hand", "available", "inventory", "stock level", "units in stock", "in stock", "stock",
    "inventory qty", "variant inventory qty", "on hand qty", "onhand",
    "skladem", "sklad", "zasoba", "zasoby", "pocet ks", "mnozstvi", "stav skladu", "dostupne mnozstvi", "skladom", "mnozstvo",
    "stan magazynowy", "stan", "ilosc", "dostepna ilosc", "bestand", "lagerbestand", "menge", "verfugbar",
    "quantite", "quantite en stock", "disponible", "existencias", "inventario", "cantidad", "stock disponible",
  ],

  barcode: ["ean", "ean13", "gtin", "gtin13", "upc", "barcode", "variant barcode", "carovy kod", "kod kreskowy", "strichcode", "codigo de barras", "code barre"],

  currency: ["currency", "currency code", "curr", "mena", "waluta", "wahrung", "waehrung", "devise", "moneda", "valuta"],

  weight: [
    "weight", "weight g", "weight kg", "grams", "variant grams", "shipping weight",
    "hmotnost", "hmotnost kg", "hmotnost g", "vaha", "waga", "gewicht", "peso", "poids",
  ],
};

/** Plain columns whose header IS the option name ("Size", "Colour"). */
export const ATTRIBUTE_HEADERS: readonly string[] = [
  "size", "sizes", "color", "colour", "material", "style", "pattern", "finish", "scent", "fragrance", "flavor", "flavour", "capacity", "length", "width",
  // Czech, Slovak, Polish, German, French, Spanish
  "velikost", "barva", "styl", "vzor", "vuni", "obsah", "delka", "sirka", "velkost", "farba", "rozmiar", "kolor", "groesse", "grosse", "farbe", "couleur", "taille", "talla", "tamano",
];

/** Names that mean "product code" when the file ALSO has a real SKU column, and "SKU" when it does not. */
export const CODE_LIKE_SKU_HEADERS: readonly string[] = ["product code", "kod produktu", "kod", "kod zbozi"];
