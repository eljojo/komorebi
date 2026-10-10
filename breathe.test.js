// Tests for breathe.js's decision — which clicks leave the page by breathing out. The DOM half (the styles, the timer, pageshow) is
// browser-only and lives in test-gl/editor.mjs. Run: `bun test breathe.test.js`.
import { expect, test } from "bun:test";
import { breathes, BREATH } from "./breathe.js";

const HERE = "https://komorebi.eljojo.net/about?x=1";
const click = (over = {}) => ({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, ...over });
const a = (href, over = {}) => ({ href, target: "", download: false, ...over });

test("a plain left click on a link to another page breathes", () => {
  expect(breathes(click(), a("https://komorebi.eljojo.net/arboretum"), HERE)).toBe(true);
  expect(breathes(click(), a("https://komorebi.eljojo.net/"), HERE)).toBe(true);
});

test("a link to another origin breathes too", () => {
  expect(breathes(click(), a("https://eljojo.net/"), HERE)).toBe(true);
  expect(breathes(click(), a("http://example.com/x"), HERE)).toBe(true);
});

test("target _self, or none, is this tab; any other target is not", () => {
  expect(breathes(click(), a("https://eljojo.net/", { target: "_self" }), HERE)).toBe(true);
  expect(breathes(click(), a("https://eljojo.net/", { target: "_blank" }), HERE)).toBe(false);
  expect(breathes(click(), a("https://eljojo.net/", { target: "_top" }), HERE)).toBe(false);
  expect(breathes(click(), a("https://eljojo.net/", { target: "frame1" }), HERE)).toBe(false);
});

test("a click that asks for a tab, a window or a download stays the browser's", () => {
  for (const mod of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) {
    expect(breathes(click({ [mod]: true }), a("https://eljojo.net/"), HERE)).toBe(false);
  }
  expect(breathes(click({ button: 1 }), a("https://eljojo.net/"), HERE)).toBe(false);
  expect(breathes(click({ button: 2 }), a("https://eljojo.net/"), HERE)).toBe(false);
});

test("a download link does not navigate", () => {
  expect(breathes(click(), a("https://komorebi.eljojo.net/dist/komorebi.player.min.js", { download: true }), HERE)).toBe(false);
});

test("a click an element already handled (preventDefault) is left alone", () => {
  expect(breathes(click({ defaultPrevented: true }), a("https://eljojo.net/"), HERE)).toBe(false);
});

test("only pages that replace this one: not javascript:, mailto:, tel:, data: or blob:", () => {
  for (const href of ["javascript:void(0)", "JavaScript:alert(1)", "mailto:jojo@eljojo.net", "tel:+15551234", "data:text/html,hi", "blob:https://x/1"]) {
    expect(breathes(click(), a(href), HERE)).toBe(false);
  }
});

test("a jump within this page does not: #fragment, or this page's own address plus one", () => {
  expect(breathes(click(), a("https://komorebi.eljojo.net/about?x=1#how"), HERE)).toBe(false);
  expect(breathes(click(), a("https://komorebi.eljojo.net/about?x=1#"), HERE)).toBe(false);
  expect(breathes(click(), a("https://komorebi.eljojo.net/about?x=1#"), `${HERE}#top`)).toBe(false);
});

test("a fragment on a different page is a navigation", () => {
  expect(breathes(click(), a("https://komorebi.eljojo.net/about?x=2#how"), HERE)).toBe(true);
  expect(breathes(click(), a("https://komorebi.eljojo.net/#feel"), HERE)).toBe(true);
  expect(breathes(click(), a("https://eljojo.net/about?x=1#how"), HERE)).toBe(true);
});

test("a link to this very page without a fragment is a reload, and breathes", () => {
  expect(breathes(click(), a(HERE), HERE)).toBe(true);
});

test("an unparseable href never breathes", () => {
  expect(breathes(click(), a("http://"), HERE)).toBe(false);
  expect(breathes(click(), a(""), HERE)).toBe(false);
  expect(breathes(click(), undefined, HERE)).toBe(false);
});

test("the breath is the welcome's: .9s ease, opacity 0, blur 10px, scale 1.04", () => {
  expect(BREATH).toEqual({ ms: 900, ease: "ease", opacity: "0", filter: "blur(10px)", transform: "scale(1.04)" });
});
