// src/app/utils/header-visibility.ts
//
// The rule behind the "smart sticky" site header, kept free of the DOM so it can be unit-tested: given where the header
// last decided something and where the page is scrolled now, should the header be shown?
//
// The state is a pivot, not the previous frame. A slow scroll moves only a pixel or two per frame, so comparing frame to
// frame would never see a "real" movement; measuring from the turning point lets small movements add up until they count.
//  - while shown, the pivot is the lowest point reached; the header hides once the page is MIN_DELTA_PX below it;
//  - while hidden, the pivot is the highest point reached; the header shows again once the page is REVEAL_DELTA_PX above it.
// Jitter smaller than those distances (a finger resting, trackpad noise) therefore changes nothing, in either direction.

/** Within this distance of the top of the page the header is always shown. */
export const TOP_ZONE_PX = 80;
/** Scrolling down by at least this much, from the lowest point reached while shown, hides the header. Smaller moves are ignored. */
export const MIN_DELTA_PX = 6;
/** Scrolling up by at least this much, from the highest point reached while hidden, shows the header again. */
export const REVEAL_DELTA_PX = 8;
/** The header's bottom border appears once the page is scrolled further than this. */
export const SCROLLED_AFTER_PX = 8;

export interface HeaderScrollState {
  visible: boolean;
  /** The pivot described above, in px from the top of the page. */
  anchorY: number;
}

export interface HeaderScrollOptions {
  /** Something keeps the header on screen (open menu, keyboard focus inside it, pointer over it, reduced motion). */
  pinned?: boolean;
  /** The largest real scroll position (document height minus viewport height), to ignore bounce past the bottom. */
  maxY?: number;
}

export function initialHeaderState(scrollY = 0): HeaderScrollState {
  return { visible: true, anchorY: Math.max(0, scrollY) };
}

/**
 * The next state for a new scroll position. Pure: nothing is read or written outside the arguments.
 * iOS rubber-banding reports a negative scrollY above the top and more than the maximum below the bottom; both are
 * clamped to the real range, so bounce is never mistaken for scrolling up or down.
 */
export function nextHeaderState(state: HeaderScrollState, currentY: number, options: HeaderScrollOptions = {}): HeaderScrollState {
  let y = Number.isFinite(currentY) ? Math.max(0, currentY) : state.anchorY;
  if (options.maxY !== undefined && Number.isFinite(options.maxY)) y = Math.min(y, Math.max(0, options.maxY));

  // Near the top, or held open: shown. The pivot follows the page so that, once released, the next real movement decides.
  if (options.pinned || y < TOP_ZONE_PX) return { visible: true, anchorY: y };

  if (state.visible) {
    const pivot = Math.min(state.anchorY, y);
    return y - pivot >= MIN_DELTA_PX ? { visible: false, anchorY: y } : { visible: true, anchorY: pivot };
  }
  const pivot = Math.max(state.anchorY, y);
  return pivot - y >= REVEAL_DELTA_PX ? { visible: true, anchorY: y } : { visible: false, anchorY: pivot };
}
