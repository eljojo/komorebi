// breathe.js — the site's way of leaving a page. Import it (or load it as a module) and every click that would navigate this tab
// first breathes the page out, as the welcome does when it gives way to "about": opacity 0, blur 10px, scale 1.04, .9s ease. The
// styles are inline, so no page needs CSS for it. Calm: nothing here asks for attention; it only slows the cut.
// Pure half: `breathes` (does this click leave?) is what breathe.test.js holds. The DOM half is browser-only.

export const BREATH = { ms: 900, ease: "ease", opacity: "0", filter: "blur(10px)", transform: "scale(1.04)" };

const hasFragment = (href) => href.includes("#");
const withoutFragment = (u) => `${u.origin}${u.pathname}${u.search}`;

// event: the click ({ button, metaKey, ctrlKey, shiftKey, altKey, defaultPrevented }); link: the anchor ({ href: resolved, target,
// download: whether the attribute is there }); here: this page's address. True when the click will navigate this tab to another
// page. An element handler that already took the click (defaultPrevented) wins — it is bubbling, so it ran first.
export function breathes(event, link, here) {
  if (!event || !link || event.defaultPrevented) return false;
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (link.target && link.target !== "_self") return false;
  if (link.download) return false;
  let to, from;
  try { to = new URL(link.href); from = new URL(here); } catch { return false; }
  if (to.protocol !== "http:" && to.protocol !== "https:") return false;   // javascript:, mailto:, tel:… leave this page standing, so it must not be breathed out
  if (hasFragment(link.href) && withoutFragment(to) === withoutFragment(from)) return false;   // a jump within this page
  return true;
}

if (typeof document !== "undefined") {
  const body = document.body;
  const styles = ["transition", "opacity", "filter", "transform"];
  let leaving = false;

  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Opacity goes on the body; the blur and the scale go on each of its children, never on the body itself. A filter or transform on
  // an element makes it the containing block of its position:fixed descendants, so a full-bleed canvas would jump to the body's box.
  const parts = () => [...body.children].filter((el) => el.tagName !== "SCRIPT");
  const breatheOut = (then) => {
    const t = `${BREATH.ms / 1000}s ${BREATH.ease}`, still = reduced();
    body.style.transition = `opacity ${t}`;
    if (!still) for (const el of parts()) el.style.transition = `filter ${t}, transform ${t}`;
    void body.offsetWidth;                                   // commit the whole state first, so the values below are a transition
    body.style.opacity = BREATH.opacity;
    if (!still) for (const el of parts()) { el.style.filter = BREATH.filter; el.style.transform = BREATH.transform; }
    setTimeout(then, BREATH.ms);
  };

  document.addEventListener("click", (e) => {
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (!a || typeof a.href !== "string") return;            // (an SVG <a> has no string href)
    const link = { href: a.href, target: a.getAttribute("target") || "", download: a.hasAttribute("download") };
    if (!breathes(e, link, location.href)) return;
    e.preventDefault();
    if (leaving) return;
    leaving = true;
    breatheOut(() => { location.href = link.href; });
  });

  // a page coming back from the back/forward cache is whole, not still breathed out
  addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    leaving = false;
    for (const el of [body, ...parts()]) for (const p of styles) el.style.removeProperty(p);
  });
}
