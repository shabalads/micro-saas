"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { type HeaderScrollState, SCROLLED_AFTER_PX, initialHeaderState, nextHeaderState } from "../../utils/header-visibility";

/**
 * Drives the "smart sticky" header: hides on scroll down, returns on scroll up (the rule itself is nextHeaderState).
 * This hook only feeds it the scroll position and decides when something must keep the header on screen:
 *  - the mobile menu is open (menuOpen),
 *  - keyboard focus is inside the header (:focus-visible, so a mouse click on a link does not hold it open),
 *  - the mouse or pen is over it (a finger is not a pointer that stays),
 *  - the visitor asked for reduced motion: then it simply never hides.
 * The scroll listener is passive and runs at most once per animation frame; React is only told when something changed.
 */
export function useSmartHeader(headerRef: RefObject<HTMLElement | null>, menuOpen: boolean): { hidden: boolean; scrolled: boolean } {
  const [hidden, setHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const pins = useRef({ menu: menuOpen, hover: false, focus: false, reducedMotion: false });
  const state = useRef<HeaderScrollState>(initialHeaderState());

  const evaluate = useCallback(() => {
    const y = window.scrollY;
    const { menu, hover, focus, reducedMotion } = pins.current;
    const maxY = document.documentElement.scrollHeight - window.innerHeight;
    state.current = nextHeaderState(state.current, y, { pinned: menu || hover || focus || reducedMotion, maxY });
    setHidden(!state.current.visible);
    setScrolled(y > SCROLLED_AFTER_PX);
  }, []);

  // The menu pin follows the prop.
  useEffect(() => {
    pins.current.menu = menuOpen;
    evaluate();
  }, [menuOpen, evaluate]);

  useEffect(() => {
    const header = headerRef.current;
    let frame = 0;

    state.current = initialHeaderState(window.scrollY);
    evaluate();

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        evaluate();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => {
      pins.current.reducedMotion = motion.matches;
      evaluate();
    };
    onMotion();
    motion.addEventListener("change", onMotion);

    const setPin = (name: "hover" | "focus", value: boolean) => {
      if (pins.current[name] === value) return;
      pins.current[name] = value;
      evaluate();
    };
    const keyboardFocusInside = () => {
      if (!header) return false;
      try {
        return header.querySelector(":focus-visible") !== null;
      } catch {
        return header.contains(document.activeElement); // a browser without :focus-visible
      }
    };
    let focusCheck = 0;
    const onFocusChange = () => {
      setPin("focus", keyboardFocusInside());
      // Moving focus from one link to the next fires focusout before the new element is focused: look again a frame later.
      cancelAnimationFrame(focusCheck);
      focusCheck = requestAnimationFrame(() => setPin("focus", keyboardFocusInside()));
    };
    const onPointerEnter = (event: PointerEvent) => {
      if (event.pointerType !== "touch") setPin("hover", true);
    };
    const onPointerLeave = () => setPin("hover", false);

    header?.addEventListener("focusin", onFocusChange);
    header?.addEventListener("focusout", onFocusChange);
    header?.addEventListener("pointerenter", onPointerEnter);
    header?.addEventListener("pointerleave", onPointerLeave);

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(focusCheck);
      window.removeEventListener("scroll", onScroll);
      motion.removeEventListener("change", onMotion);
      header?.removeEventListener("focusin", onFocusChange);
      header?.removeEventListener("focusout", onFocusChange);
      header?.removeEventListener("pointerenter", onPointerEnter);
      header?.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [headerRef, evaluate]);

  return { hidden, scrolled };
}
