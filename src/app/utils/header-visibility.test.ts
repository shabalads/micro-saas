import { describe, expect, it } from "vitest";
import {
  MIN_DELTA_PX,
  REVEAL_DELTA_PX,
  SCROLLED_AFTER_PX,
  TOP_ZONE_PX,
  type HeaderScrollState,
  initialHeaderState,
  nextHeaderState,
} from "./header-visibility";

const shown = (anchorY: number): HeaderScrollState => ({ visible: true, anchorY });
const hidden = (anchorY: number): HeaderScrollState => ({ visible: false, anchorY });

/** Feeds a list of scroll positions through the rule, as the browser would frame by frame. */
function scrollThrough(start: HeaderScrollState, positions: number[], options = {}) {
  return positions.reduce((state, y) => nextHeaderState(state, y, options), start);
}

describe("nextHeaderState", () => {
  describe("near the top of the page", () => {
    it("is always shown, whatever happened before", () => {
      expect(nextHeaderState(hidden(900), 0).visible).toBe(true);
      expect(nextHeaderState(hidden(900), TOP_ZONE_PX - 1).visible).toBe(true);
      expect(nextHeaderState(shown(0), 40).visible).toBe(true);
    });

    it("can only hide beyond the top zone, and then still needs real downward movement", () => {
      expect(nextHeaderState(shown(TOP_ZONE_PX - 1), TOP_ZONE_PX + 2).visible).toBe(true); // 3px past the boundary: jitter
      expect(nextHeaderState(shown(TOP_ZONE_PX - 1), TOP_ZONE_PX - 1 + MIN_DELTA_PX).visible).toBe(false);
      expect(nextHeaderState(shown(0), TOP_ZONE_PX).visible).toBe(false); // a fast flick from 0 to the boundary in one frame
    });
  });

  describe("scrolling down", () => {
    it("hides the header once the page has moved MIN_DELTA_PX or more", () => {
      expect(nextHeaderState(shown(300), 300 + MIN_DELTA_PX)).toEqual(hidden(300 + MIN_DELTA_PX));
      expect(nextHeaderState(shown(300), 600)).toEqual(hidden(600));
    });

    it("ignores a movement smaller than MIN_DELTA_PX (jitter), and keeps the pivot", () => {
      expect(nextHeaderState(shown(300), 300 + MIN_DELTA_PX - 1)).toEqual(shown(300));
      expect(nextHeaderState(shown(300), 302)).toEqual(shown(300));
    });

    it("adds up a slow scroll of a pixel or two per frame instead of ignoring every frame", () => {
      const positions = Array.from({ length: 8 }, (_, i) => 300 + (i + 1) * 2); // 302 ... 316
      expect(scrollThrough(shown(300), positions).visible).toBe(false);
    });

    it("stays hidden while scrolling on down", () => {
      expect(scrollThrough(shown(300), [320, 340, 400, 800]).visible).toBe(false);
    });
  });

  describe("scrolling up", () => {
    it("shows the header again after REVEAL_DELTA_PX, even a small scroll", () => {
      expect(nextHeaderState(hidden(600), 600 - REVEAL_DELTA_PX)).toEqual(shown(600 - REVEAL_DELTA_PX));
      expect(nextHeaderState(hidden(600), 590)).toEqual(shown(590));
    });

    it("ignores a movement smaller than REVEAL_DELTA_PX", () => {
      expect(nextHeaderState(hidden(600), 600 - REVEAL_DELTA_PX + 1)).toEqual(hidden(600));
      expect(nextHeaderState(hidden(600), 596)).toEqual(hidden(600));
    });

    it("measures from the lowest point reached, not from where the header happened to hide", () => {
      // hidden at 600, the user keeps going to 650 but then turns back up: 8px above 650 is enough
      const state = scrollThrough(hidden(600), [620, 650, 646, 642]);
      expect(state.visible).toBe(true);
      expect(state.anchorY).toBe(642);
    });

    it("adds up a slow scroll up", () => {
      const positions = Array.from({ length: 6 }, (_, i) => 600 - (i + 1) * 2); // 598 ... 588
      expect(scrollThrough(hidden(600), positions).visible).toBe(true);
    });

    it("then hides again after the next real movement down, measured from where it was shown", () => {
      let state = nextHeaderState(hidden(600), 590);
      state = nextHeaderState(state, 593);
      expect(state.visible).toBe(true);
      state = nextHeaderState(state, 590 + MIN_DELTA_PX);
      expect(state.visible).toBe(false);
    });
  });

  describe("jitter around a standstill", () => {
    it("never flips the header while shown", () => {
      const state = scrollThrough(shown(500), [502, 499, 503, 500, 504, 498, 501]);
      expect(state.visible).toBe(true);
    });

    it("never flips the header while hidden", () => {
      const state = scrollThrough(hidden(500), [502, 499, 503, 500, 504, 497, 501]);
      expect(state.visible).toBe(false);
    });
  });

  describe("iOS rubber-band", () => {
    it("treats a negative scrollY as the top of the page: shown, never a scroll up or down", () => {
      expect(nextHeaderState(shown(0), -40)).toEqual(shown(0));
      expect(nextHeaderState(hidden(900), -1)).toEqual(shown(0));
      // the bounce back to 0 afterwards changes nothing
      expect(scrollThrough(shown(0), [-30, -60, -20, 0])).toEqual(shown(0));
    });

    it("does not turn the bounce past the bottom of the page into a scroll up", () => {
      const options = { maxY: 2000 };
      const atBottom = scrollThrough(hidden(1500), [1800, 2000], options);
      expect(atBottom).toEqual(hidden(2000));
      // overscroll to 2060 and the spring back through 2030 to 2000: all clamped to 2000, so nothing moved
      expect(scrollThrough(atBottom, [2030, 2060, 2040, 2010, 2000], options)).toEqual(hidden(2000));
    });

    it("ignores a non-numeric position", () => {
      expect(nextHeaderState(shown(300), Number.NaN)).toEqual(shown(300));
      expect(nextHeaderState(hidden(300), Number.NaN)).toEqual(hidden(300));
    });
  });

  describe("pinned (open menu, keyboard focus, pointer over the header, reduced motion)", () => {
    it("shows a hidden header at once", () => {
      expect(nextHeaderState(hidden(900), 900, { pinned: true })).toEqual(shown(900));
    });

    it("never hides, however far the page is scrolled down", () => {
      expect(scrollThrough(shown(300), [320, 400, 900], { pinned: true }).visible).toBe(true);
    });

    it("lets go gently: once released, the header stays until the next real scroll down", () => {
      let state = scrollThrough(shown(300), [320, 400, 900], { pinned: true });
      state = nextHeaderState(state, 900); // released, nothing moved
      expect(state.visible).toBe(true);
      expect(nextHeaderState(state, 900 + MIN_DELTA_PX - 1).visible).toBe(true);
      expect(nextHeaderState(state, 900 + MIN_DELTA_PX).visible).toBe(false);
    });
  });

  it("starts shown, at the page's current scroll position", () => {
    expect(initialHeaderState()).toEqual(shown(0));
    expect(initialHeaderState(1200)).toEqual(shown(1200));
    expect(initialHeaderState(-50)).toEqual(shown(0));
  });

  it("does not modify the state it was given", () => {
    const state = Object.freeze(shown(300));
    expect(() => nextHeaderState(state, 700)).not.toThrow();
    expect(state).toEqual(shown(300));
  });

  it("has the thresholds the design calls for", () => {
    expect(TOP_ZONE_PX).toBe(80);
    expect(MIN_DELTA_PX).toBe(6);
    expect(REVEAL_DELTA_PX).toBeGreaterThanOrEqual(8);
    expect(REVEAL_DELTA_PX).toBeLessThanOrEqual(10);
    expect(SCROLLED_AFTER_PX).toBeGreaterThan(0);
  });
});
