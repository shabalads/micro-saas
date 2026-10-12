// src/app/utils/row-numbers.ts
//
// Every row number a warning gives is the number Excel and Google Sheets show for that row of the supplier's file: the header
// is row 1, the first product row is row 2, a blank line is a row, and a record whose quoted cells hold line breaks is ONE row.

/** The row number of the first product row (the one right under the header). */
export const FIRST_DATA_ROW = 2;

/** The spreadsheet row of a record, from its 0-based position among the records under the header (blank lines included). */
export const spreadsheetRow = (recordIndex: number): number => recordIndex + FIRST_DATA_ROW;
