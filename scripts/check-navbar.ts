// scripts/check-navbar.ts
//
// Browser check of the "smart sticky" site header, in a real headless Chrome (no extra dependency: it speaks the DevTools
// protocol directly, like scripts/e2e-stripe.ts). It only reads pages, and needs the app running:
//
//   npm run dev                       # or: npm run build && npm start
//   npm run check:navbar              # http://localhost:3000
//   npm run check:navbar -- --app=http://localhost:3100  --screenshots=./navbar-shots
//
// What it proves, per page (landing, /fix, a guide, the legal pages, /contact, /recover): the header is sticky; scrolling
// down hides it; a small scroll up (but not a tiny one) shows it again; the top of the page shows it; the page below does not
// move. On the landing page also: keyboard focus and the pointer keep it visible, the mobile menu (390 and 320 wide) keeps
// it visible and fits, reduced motion never hides it, and in-page links land below it.
//
// Exit code: 0 everything passed | 1 something failed | 2 could not start.

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { MIN_DELTA_PX, REVEAL_DELTA_PX, TOP_ZONE_PX } from "../src/app/utils/header-visibility.ts";

function option(name: string): string | undefined {
  return process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}
const APP = (option("app") ?? process.env.E2E_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const SHOTS = option("screenshots");

const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function findChrome(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]) {
    for (const dir of (process.env.PATH ?? "").split(delimiter)) {
      const full = join(dir, name);
      if (dir && existsSync(full)) return full;
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Headless Chrome over the DevTools protocol                                 */
/* -------------------------------------------------------------------------- */

interface HeaderProbe {
  top: number;
  bottom: number;
  height: number;
  width: number;
  position: string;
  topCss: string;
  zIndex: string;
  border: string;
  duration: string;
  transitionProperty: string;
  state: string | undefined;
  scrollY: number;
  maxScroll: number;
  mainTop: number;
  pageHeight: number;
}

const PROBE = `(() => {
  const header = document.querySelector('[data-site-header]');
  if (!header) return null;
  const rect = header.getBoundingClientRect();
  const style = getComputedStyle(header);
  const main = document.querySelector('main');
  return {
    top: rect.top, bottom: rect.bottom, height: rect.height, width: rect.width,
    position: style.position, topCss: style.top, zIndex: style.zIndex, border: style.borderBottomColor, duration: style.transitionDuration, transitionProperty: style.transitionProperty,
    state: header.dataset.state, scrollY: window.scrollY, maxScroll: document.documentElement.scrollHeight - window.innerHeight,
    mainTop: main ? main.getBoundingClientRect().top + window.scrollY : -1, pageHeight: document.documentElement.scrollHeight,
  };
})()`;

class Page {
  private process: ChildProcess | null = null;
  private socket: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  private profile = "";

  async open(executable: string): Promise<void> {
    this.profile = mkdtempSync(join(tmpdir(), "check-navbar-chrome-"));
    const port = 9400 + Math.floor(Math.random() * 500);
    this.process = spawn(
      executable,
      ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${this.profile}`, "--no-first-run", "--disable-gpu", "--disable-background-networking", "--window-size=1280,800", "--lang=en-US", "about:blank"],
      { stdio: "ignore" },
    );
    let target: { webSocketDebuggerUrl: string } | undefined;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
        target = list.find((entry) => entry.type === "page");
      } catch {
        /* not up yet */
      }
      if (!target) await sleep(250);
    }
    if (!target) throw new Error("Chrome did not start");
    this.socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolveOpen, reject) => {
      this.socket!.onopen = () => resolveOpen();
      this.socket!.onerror = () => reject(new Error("could not connect to Chrome"));
    });
    this.socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: Record<string, unknown>; error?: { message: string } };
      if (message.id !== undefined && this.pending.has(message.id)) {
        const waiter = this.pending.get(message.id)!;
        this.pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result ?? {});
      }
    };
    await this.send("Page.enable");
    await this.send("Runtime.enable");
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject });
      this.socket!.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval<T>(expression: string): Promise<T> {
    const result = (await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })) as {
      result: { value: T };
      exceptionDetails?: { exception?: { description?: string }; text: string };
    };
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }

  async viewport(width: number, height: number, mobile: boolean): Promise<void> {
    await this.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
    await this.send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
  }

  async reducedMotion(on: boolean): Promise<void> {
    await this.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: on ? "reduce" : "no-preference" }] });
  }

  /** Opens a page and waits until React has taken it over (the header's listeners are attached by then). */
  async goto(path: string): Promise<void> {
    await this.send("Page.navigate", { url: `${APP}${path}` });
    await sleep(150);
    const deadline = Date.now() + 45_000;
    for (;;) {
      const ready = await this.eval<boolean>(
        `document.readyState === 'complete' && (() => { const h = document.querySelector('[data-site-header]'); return !!h && Object.keys(h).some((key) => key.startsWith('__reactProps$')); })()`,
      ).catch(() => false);
      if (ready) break;
      if (Date.now() > deadline) throw new Error(`${path} did not load and hydrate within 45s`);
      await sleep(200);
    }
    await sleep(400); // effects that attach the scroll listener run just after hydration
    await this.eval(`window.__shifts = 0; new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__shifts += e.value; }).observe({ type: 'layout-shift' }); true`);
  }

  probe(): Promise<HeaderProbe> {
    return this.eval<HeaderProbe | null>(PROBE).then((value) => {
      if (!value) throw new Error("this page has no [data-site-header]");
      return value;
    });
  }

  async scrollTo(y: number): Promise<void> {
    await this.eval(`window.scrollTo(0, ${y}); true`);
  }
  async scrollBy(dy: number): Promise<void> {
    await this.eval(`window.scrollBy(0, ${dy}); true`);
  }

  async key(key: "Tab" | "Escape", shift = false): Promise<void> {
    const code = key === "Tab" ? 9 : 27;
    const base = { key, code: key, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 };
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", ...base });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  async moveMouse(x: number, y: number): Promise<void> {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  }
  async pressMouse(x: number, y: number): Promise<void> {
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }

  async shot(name: string): Promise<void> {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    const { data } = (await this.send("Page.captureScreenshot", { format: "png" })) as { data: string };
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, "base64"));
  }

  async close(): Promise<void> {
    try {
      this.socket?.close();
    } catch {
      /* already closed */
    }
    this.process?.kill();
    await sleep(300);
    if (this.profile) rmSync(this.profile, { recursive: true, force: true });
  }
}

/* -------------------------------------------------------------------------- */
/*  Tiny test runner                                                           */
/* -------------------------------------------------------------------------- */

let failures = 0;
let stepNumber = 0;

async function step(name: string, run: () => Promise<string | void>): Promise<void> {
  stepNumber++;
  const label = `[${String(stepNumber).padStart(2, "0")}] ${name}`;
  try {
    const detail = await run();
    console.log(`ok    ${label}${detail ? `  (${detail})` : ""}`);
  } catch (error) {
    failures++;
    console.log(`FAIL  ${label}\n        ${error instanceof Error ? error.message : String(error)}`);
  }
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Polls the header until `check` holds (animations take 200ms), and fails with what it saw if it never does. */
async function settle(page: Page, what: string, check: (probe: HeaderProbe) => boolean, timeoutMs = 3000): Promise<HeaderProbe> {
  const deadline = Date.now() + timeoutMs;
  let last = await page.probe();
  while (!check(last)) {
    if (Date.now() > deadline) {
      throw new Error(`${what}: header top=${last.top.toFixed(1)} bottom=${last.bottom.toFixed(1)} state=${last.state} at scrollY=${last.scrollY}`);
    }
    await sleep(60);
    last = await page.probe();
  }
  return last;
}
const isShown = (probe: HeaderProbe) => Math.abs(probe.top) < 1 && probe.state === "visible";
const isHidden = (probe: HeaderProbe) => probe.bottom <= 0.5 && probe.state === "hidden";
/** A computed colour whose alpha is (almost) zero. The border fades over 200ms, so callers settle first. */
function isTransparent(color: string): boolean {
  if (color === "transparent") return true;
  const alpha = /\/\s*([\d.]+)\)$/.exec(color)?.[1] ?? /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/.exec(color)?.[1];
  return alpha !== undefined && Number(alpha) < 0.02;
}

/** Lets a movement that must NOT change anything run its course, then returns the header as it is. */
async function quiet(page: Page): Promise<HeaderProbe> {
  await sleep(500);
  return page.probe();
}

/* -------------------------------------------------------------------------- */
/*  Scenarios                                                                  */
/* -------------------------------------------------------------------------- */

async function behaviourOn(page: Page, path: string): Promise<string> {
  await page.viewport(1280, 720, false);
  await page.reducedMotion(false);
  await page.goto(path);

  let probe = await page.probe();
  if (probe.maxScroll < 500) {
    // A short page (the recover form): make the window short enough that it scrolls.
    await page.viewport(1280, Math.max(300, probe.pageHeight - 500), false);
    await page.goto(path);
    probe = await page.probe();
  }
  expect(probe.maxScroll >= 300, `${path} is too short to scroll (${probe.maxScroll}px of scroll)`);
  const down = Math.min(400, probe.maxScroll - 10);
  expect(probe.position === "sticky" && probe.topCss === "0px", `header is position ${probe.position} / top ${probe.topCss}, expected sticky / 0px`);
  expect(Number(probe.zIndex) >= 40, `z-index is ${probe.zIndex}, expected 40 or more`);
  expect(isShown(probe), `at the top the header is not shown (top=${probe.top})`);
  expect(isTransparent(probe.border), `the bottom border should not show at the very top (it is ${probe.border})`);
  expect(probe.transitionProperty.includes("transform"), `the header should animate transform, it animates: ${probe.transitionProperty}`);
  const before = { mainTop: probe.mainTop, pageHeight: probe.pageHeight, height: probe.height };
  await page.shot(`${slug(path)}-1-top`);

  await page.scrollTo(TOP_ZONE_PX - 20);
  probe = await quiet(page);
  expect(isShown(probe), `inside the top ${TOP_ZONE_PX}px the header must stay shown`);

  await page.scrollTo(down);
  probe = await settle(page, `scrolling down ${down}px should hide the header`, isHidden);
  expect(/^0\.2s(, 0\.2s)*$/.test(probe.duration), `transition is ${probe.duration}, expected 0.2s`);
  await page.shot(`${slug(path)}-2-hidden`);

  await page.scrollBy(-(REVEAL_DELTA_PX - 4));
  probe = await quiet(page);
  expect(isHidden(probe), `a ${REVEAL_DELTA_PX - 4}px scroll up is jitter and must not show the header`);

  await page.scrollBy(-(REVEAL_DELTA_PX + 2));
  probe = await settle(page, `a scroll up of about ${REVEAL_DELTA_PX + 6}px in total should show the header`, isShown);
  probe = await settle(page, "once scrolled, the bottom border should show", (now) => !isTransparent(now.border));
  await page.shot(`${slug(path)}-3-shown-again`);

  await page.scrollBy(MIN_DELTA_PX - 2);
  probe = await quiet(page);
  expect(isShown(probe), `a ${MIN_DELTA_PX - 2}px scroll down is jitter and must not hide the header`);

  await page.scrollBy(MIN_DELTA_PX + 40);
  await settle(page, "a real scroll down hides it again", isHidden);

  await page.scrollTo(0);
  probe = await settle(page, "the top of the page shows the header", isShown);
  probe = await settle(page, "the border should be gone again at the top", (now) => isTransparent(now.border));

  expect(probe.mainTop === before.mainTop && probe.pageHeight === before.pageHeight && probe.height === before.height, `the layout moved: main ${before.mainTop} -> ${probe.mainTop}, page ${before.pageHeight} -> ${probe.pageHeight}`);
  const shifts = await page.eval<number>("window.__shifts");
  expect(shifts === 0, `the browser recorded ${shifts} layout shift`);
  return `sticky, hides on scroll down, returns on ${REVEAL_DELTA_PX}px+ up, ${before.height}px tall, no layout shift`;
}

const slug = (path: string) => (path === "/" ? "home" : path.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-"));

async function main(): Promise<number> {
  const chrome = findChrome();
  if (!chrome) {
    console.error("Chrome was not found. Install Google Chrome or set CHROME_PATH.");
    return 2;
  }
  const up = await fetch(`${APP}/api/health`).catch(() => null);
  if (!up) {
    console.error(`Nothing answers at ${APP}. Start the app (npm run dev) or pass --app=<url>.`);
    return 2;
  }
  const page = new Page();
  await page.open(chrome);
  console.log(`App: ${APP}\n`);

  try {
    // A guide page to test: the first link on /fix that goes to a guide.
    await page.goto("/fix");
    const guide = await page.eval<string | null>(`(document.querySelector('main a[href^="/fix/"]') || {}).getAttribute?.('href') ?? null`);
    const pages = ["/", "/fix", ...(guide ? [guide] : []), "/privacy", "/terms", "/refunds", "/contact", "/recover"];
    if (!guide) await step("a guide page exists under /fix", async () => { throw new Error("/fix links to no guide, so a guide page could not be checked"); });

    for (const path of pages) await step(`${path}: smart sticky behaviour (desktop 1280px)`, () => behaviourOn(page, path));

    /* ---- keyboard focus and the pointer, on the landing page ---- */
    await step("keyboard focus inside the header keeps it visible, and releasing it lets it hide again", async () => {
      await page.viewport(1280, 720, false);
      await page.goto("/");
      await page.scrollTo(900);
      await settle(page, "header hidden before the focus test", isHidden);
      await page.key("Tab");
      const focusedInside = await page.eval<boolean>(`!!document.activeElement && !!document.activeElement.closest('[data-site-header]')`);
      if (!focusedInside) await page.eval(`document.querySelector('[data-site-header] nav a').focus(); true`); // Chrome starts Tab from the top of the document
      expect(await page.eval<boolean>(`!!document.querySelector('[data-site-header] :focus-visible')`), "the focused element in the header does not match :focus-visible (the test could not simulate the keyboard)");
      await settle(page, "focusing a link in the header should bring it back", isShown);
      await page.scrollBy(500);
      const stillShown = await quiet(page);
      expect(isShown(stillShown), `scrolling down while a header link has keyboard focus hid the header (top=${stillShown.top})`);
      await page.key("Tab");
      await page.scrollBy(300);
      expect(isShown(await quiet(page)), "tabbing from one header link to the next let the header hide");
      await page.eval(`document.activeElement.blur(); true`);
      await page.scrollBy(200);
      await settle(page, "after focus left the header, scrolling down hides it", isHidden);
      return "shown while focused, hides after blur";
    });

    await step("the pointer over the header keeps it visible; moving away lets it hide on the next scroll down", async () => {
      await page.viewport(1280, 720, false);
      await page.goto("/");
      await page.scrollTo(900);
      await settle(page, "hidden before the hover test", isHidden);
      await page.scrollBy(-30);
      await settle(page, "shown again by scrolling up", isShown);
      await page.moveMouse(640, 30);
      await sleep(150);
      await page.scrollBy(500);
      expect(isShown(await quiet(page)), "scrolling down with the mouse over the header hid it");
      await page.moveMouse(640, 500);
      await sleep(150);
      expect(isShown(await quiet(page)), "moving the mouse away hid the header at once (it should wait for the next scroll down)");
      await page.scrollBy(200);
      await settle(page, "after the pointer left, scrolling down hides it", isHidden);
      return "shown while hovered, hides after the pointer leaves and the page scrolls";
    });

    /* ---- the mobile menu, at two phone widths ---- */
    for (const width of [390, 360, 320]) {
      await step(`mobile ${width}px: the header fits, hides and returns, and the open menu keeps it visible`, async () => {
        await page.viewport(width, 800, true);
        await page.goto("/");
        const fit = await page.eval<{ overflow: number; ctaRight: number; buttonRight: number; buttonVisible: boolean; desktopLinksVisible: boolean; brandRight: number; ctaLeft: number; ctaHeight: number; headerHeight: number }>(`(() => {
          const header = document.querySelector('[data-site-header]');
          const visible = (el) => !!el && el.getClientRects().length > 0;
          const cta = header.querySelector('nav[aria-label="Main"] a[href="/#tool"]');
          const button = header.querySelector('button[aria-controls]');
          const brand = header.querySelector('a[aria-label="Home"]');
          return {
            overflow: document.documentElement.scrollWidth - window.innerWidth,
            ctaRight: cta.getBoundingClientRect().right, ctaLeft: cta.getBoundingClientRect().left, ctaHeight: cta.getBoundingClientRect().height, headerHeight: header.getBoundingClientRect().height,
            buttonRight: button.getBoundingClientRect().right, buttonVisible: visible(button),
            brandRight: brand.getBoundingClientRect().right,
            desktopLinksVisible: [...header.querySelectorAll('nav[aria-label="Main"] a')].filter((a) => a !== cta).some(visible),
          };
        })()`);
        await page.shot(`mobile-${width}-1-top`);
        expect(fit.overflow <= 0, `the page scrolls sideways by ${fit.overflow}px`);
        expect(fit.buttonVisible && !fit.desktopLinksVisible, "on a phone the menu button should show and the desktop links should not");
        expect(fit.buttonRight <= width && fit.ctaRight <= width, `the header spills out of the screen: button right ${fit.buttonRight}, CTA right ${fit.ctaRight}`);
        if (width >= 360) expect(fit.ctaHeight < 40 && fit.headerHeight <= 72, `the bar should be one row from 360px up: the "Clean a CSV" button is ${fit.ctaHeight}px tall and the header ${fit.headerHeight}px`);
        expect(fit.brandRight <= fit.ctaLeft, `the brand (right edge ${fit.brandRight}) overlaps the "Clean a CSV" button (left edge ${fit.ctaLeft})`);

        await page.scrollTo(700);
        await settle(page, "scrolling down on a phone hides the header", isHidden);
        await page.scrollBy(-(REVEAL_DELTA_PX + 4));
        await settle(page, "a small scroll up on a phone shows it", isShown);

        await page.eval(`document.querySelector('[data-site-header] button[aria-controls]').click(); true`);
        const open = await page.eval<{ expanded: string | null; links: number; shown: boolean }>(`(() => {
          const menu = document.getElementById('site-mobile-menu');
          return { expanded: document.querySelector('[data-site-header] button[aria-controls]').getAttribute('aria-expanded'), links: menu.querySelectorAll('a').length, shown: menu.getClientRects().length > 0 };
        })()`);
        expect(open.expanded === "true" && open.shown && open.links === 4, `the menu did not open with its 4 links: ${JSON.stringify(open)}`);
        await page.shot(`mobile-${width}-2-menu-open`);
        await page.scrollBy(900);
        expect(isShown(await quiet(page)), "scrolling down hid the header while the mobile menu was open");

        await page.pressMouse(width / 2, 700); // a tap on the page, outside the header
        await sleep(200);
        expect(await page.eval<boolean>(`document.querySelector('[data-site-header] button[aria-controls]').getAttribute('aria-expanded') === 'false'`), "tapping outside did not close the menu");
        await page.scrollBy(200);
        await settle(page, "with the menu closed, the header hides on scroll down again", isHidden);

        await page.scrollBy(-20);
        await settle(page, "shown again", isShown);
        await page.eval(`document.querySelector('[data-site-header] button[aria-controls]').click(); true`);
        await page.key("Escape");
        expect(await page.eval<boolean>(`document.querySelector('[data-site-header] button[aria-controls]').getAttribute('aria-expanded') === 'false'`), "Escape did not close the menu");
        expect(await page.eval<boolean>(`document.activeElement === document.querySelector('[data-site-header] button[aria-controls]')`), "Escape did not return focus to the menu button");
        return `no sideways scroll, menu opens with 4 links, header stays while open, closes on tap outside and Escape`;
      });
    }

    await step("a menu link closes the menu", async () => {
      await page.viewport(390, 800, true);
      await page.goto("/");
      await page.eval(`document.querySelector('[data-site-header] button[aria-controls]').click(); true`);
      await page.eval(`document.querySelector('#site-mobile-menu a[href="/#pricing"]').click(); true`);
      await sleep(600);
      expect(await page.eval<boolean>(`document.querySelector('[data-site-header] button[aria-controls]').getAttribute('aria-expanded') === 'false'`), "the menu stayed open after choosing a link");
      const target = await page.eval<number>(`document.getElementById('pricing').getBoundingClientRect().top`);
      const headerHeight = (await page.probe()).height;
      expect(target >= headerHeight - 0.5, `#pricing lands at ${target.toFixed(0)}px, under the ${headerHeight}px header`);
      return `#pricing lands ${target.toFixed(0)}px from the top, the header is ${headerHeight}px`;
    });

    /* ---- reduced motion ---- */
    await step("prefers-reduced-motion: the header never slides away and does not animate", async () => {
      await page.viewport(1280, 720, false);
      await page.reducedMotion(true);
      await page.goto("/");
      await page.scrollTo(900);
      const probe = await quiet(page);
      expect(isShown(probe), `the header hid under prefers-reduced-motion (top=${probe.top})`);
      expect(probe.transitionProperty === "none", `transition-property is ${probe.transitionProperty}, expected none`);
      await page.scrollBy(400);
      expect(isShown(await quiet(page)), "the header hid after further scrolling under prefers-reduced-motion");
      await page.reducedMotion(false);
      return "always shown, no transition";
    });

    /* ---- in-page links land below the header ---- */
    await step("in-page links and headings land clear of the header (landing sections, guide headings, legal headings)", async () => {
      await page.viewport(1280, 720, false);
      await page.reducedMotion(false);
      const clearance = async (path: string, selector: string) => {
        await page.goto(path);
        const headerHeight = (await page.probe()).height;
        const result = await page.eval<Array<{ id: string; top: number; margin: number }>>(`(() => {
          return [...document.querySelectorAll(${JSON.stringify(selector)})].map((el) => {
            el.scrollIntoView();
            return { id: el.id || el.tagName.toLowerCase() + ':' + el.textContent.trim().slice(0, 24), top: el.getBoundingClientRect().top, margin: parseFloat(getComputedStyle(el).scrollMarginTop) };
          });
        })()`);
        expect(result.length > 0, `${path} has nothing matching ${selector}`);
        const covered = result.filter((entry) => entry.top < headerHeight - 0.5 && entry.margin < headerHeight);
        expect(covered.length === 0, `${path}: ${covered.map((entry) => `${entry.id} lands at ${entry.top.toFixed(0)}px under the ${headerHeight}px header`).join("; ")}`);
        return result.length;
      };
      const sections = await clearance("/", "main section[id], main [id='guarantee']");
      const guideHeadings = guide ? await clearance(guide, "main h2") : 0;
      const legalHeadings = await clearance("/privacy", "main h2");
      // Landing via a URL fragment, as a visitor following a link from another page does.
      await page.goto("/#faq");
      await sleep(300);
      const faq = await page.eval<number>(`document.getElementById('faq').getBoundingClientRect().top`);
      const headerHeight = (await page.probe()).height;
      expect(faq >= headerHeight - 0.5, `/#faq lands at ${faq.toFixed(0)}px, under the ${headerHeight}px header`);
      return `${sections} landing sections, ${guideHeadings} guide headings, ${legalHeadings} legal headings clear of the ${headerHeight}px header; /#faq lands at ${faq.toFixed(0)}px`;
    });
  } finally {
    await page.close();
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  return failures === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error("check-navbar crashed:", error instanceof Error ? error.message : error);
    process.exit(1);
  },
);

