// src/app/utils/tech-terms.ts
//
// Technical terms whose capitals are part of the spelling, so Title Case and sentence case must not "fix" them:
// GaN, ANC, NFC, OLED, PoE, IPX7, USB-C, HDMI, LED, RGB, 4K, SSD, GPS, UPF ... To add one, put it in the right list.
// (Terms with a digit - IPX7, 4K, RTX3080, 2.4GHz - and units - 750ml, 20000mAh - are handled by rules in sanitizer.ts, and
// USB-C is USB plus the lone letter C, both known; this file is for the words a rule cannot guess.)

/** Words that are always written in capitals. */
export const TECH_UPPER: readonly string[] = [
  "anc", "nfc", "oled", "amoled", "qled", "upf", "ips", "nvme", "hdmi", "usb", "led", "rgb", "ssd", "hdd", "gps", "lcd", "uhd", "cpu", "gpu",
  // size and fit codes that are not a size in the S/M/L sense
  "os", "osfa",
];

/** Words with a mix of capitals, written exactly like this. */
export const TECH_MIXED: ReadonlyArray<readonly [string, string]> = [
  ["gan", "GaN"],
  ["poe", "PoE"],
];
