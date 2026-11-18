// Lucide icon geometry (ISC license, lucide.dev), inlined so the site ships no icon library.
// Every icon is drawn on a 24x24 grid with a 2px round stroke; Icon.astro renders the nodes.

export type IconNode =
  | { tag: "path"; d: string }
  | { tag: "circle"; cx: number; cy: number; r: number }
  | { tag: "rect"; x: number; y: number; width: number; height: number; rx: number }
  | { tag: "polyline"; points: string };

const path = (d: string): IconNode => ({ tag: "path", d });
const circle = (cx: number, cy: number, r: number): IconNode => ({ tag: "circle", cx, cy, r });
const rect = (x: number, y: number, width: number, height: number, rx: number): IconNode => ({ tag: "rect", x, y, width, height, rx });

export const ICONS = {
  "arrow-right": [path("M5 12h14"), path("m12 5 7 7-7 7")],
  "badge-check": [
    path("M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"),
    path("m9 12 2 2 4-4"),
  ],
  "bar-chart": [path("M3 3v16a2 2 0 0 0 2 2h16"), path("M18 17V9"), path("M13 17V5"), path("M8 17v-3")],
  check: [path("M20 6 9 17l-5-5")],
  "chevron-right": [path("m9 18 6-6-6-6")],
  "chevron-down": [path("m6 9 6 6 6-6")],
  "circle-check": [circle(12, 12, 10), path("m9 12 2 2 4-4")],
  clock: [circle(12, 12, 10), path("M12 6v6l4 2")],
  compass: [path("m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"), circle(12, 12, 10)],
  copy: [rect(8, 8, 14, 14, 2), path("M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2")],
  "external-link": [path("M15 3h6v6"), path("M10 14 21 3"), path("M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6")],
  "file-text": [
    path("M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"),
    path("M14 2v4a2 2 0 0 0 2 2h4"),
    path("M10 9H8"),
    path("M16 13H8"),
    path("M16 17H8"),
  ],
  "file-user": [
    path("M14 2v4a2 2 0 0 0 2 2h4"),
    path("M15 18a3 3 0 1 0-6 0"),
    path("M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"),
    circle(12, 13, 2),
  ],
  "git-fork": [circle(12, 18, 3), circle(6, 6, 3), circle(18, 6, 3), path("M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"), path("M12 12v3")],
  globe: [circle(12, 12, 10), path("M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"), path("M2 12h20")],
  inbox: [
    path("M22 12h-6l-2 3h-4l-2-3H2"),
    path("M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"),
  ],
  info: [circle(12, 12, 10), path("M12 16v-4"), path("M12 8h.01")],
  layers: [
    path("M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"),
    path("M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"),
    path("M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"),
  ],
  "list-checks": [path("m3 17 2 2 4-4"), path("m3 7 2 2 4-4"), path("M13 6h8"), path("M13 12h8"), path("M13 18h8")],
  megaphone: [path("m3 11 18-5v12L3 14v-3z"), path("M11.6 16.8a3 3 0 1 1-5.8-1.6")],
  pause: [rect(14, 4, 4, 16, 1), rect(6, 4, 4, 16, 1)],
  play: [path("M6 3l14 9-14 9z")],
  palette: [
    circle(13.5, 6.5, 0.5),
    circle(17.5, 10.5, 0.5),
    circle(8.5, 7.5, 0.5),
    circle(6.5, 12.5, 0.5),
    path("M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"),
  ],
  puzzle: [
    path("M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"),
  ],
  radar: [
    path("M19.07 4.93A10 10 0 0 0 6.99 3.34"),
    path("M4 6h.01"),
    path("M2.29 9.62A10 10 0 1 0 21.31 8.35"),
    path("M16.24 7.76A6 6 0 1 0 8.23 16.67"),
    path("M12 18h.01"),
    path("M17.99 11.66A6 6 0 0 1 15.77 16.67"),
    circle(12, 12, 2),
    path("m13.41 10.59 5.66-5.66"),
  ],
  scale: [
    path("m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"),
    path("m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"),
    path("M7 21h10"),
    path("M12 3v18"),
    path("M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"),
  ],
  search: [circle(11, 11, 8), path("m21 21-4.3-4.3")],
  "search-x": [path("m13.5 8.5-5 5"), path("m8.5 8.5 5 5"), circle(11, 11, 8), path("m21 21-4.3-4.3")],
  "shield-alert": [
    path("M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"),
    path("M12 8v4"),
    path("M12 16h.01"),
  ],
  star: [
    path("M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"),
  ],
  terminal: [{ tag: "polyline", points: "4 17 10 11 4 5" }, path("M12 19h8")],
  "triangle-alert": [path("m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"), path("M12 9v4"), path("M12 17h.01")],
  workflow: [rect(3, 3, 8, 8, 2), path("M7 11v4a2 2 0 0 0 2 2h4"), rect(13, 13, 8, 8, 2)],
  home: [path("M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"), path("M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z")],
  menu: [path("M4 6h16"), path("M4 12h16"), path("M4 18h16")],
  x: [path("M18 6 6 18"), path("m6 6 12 12")],
  "chevron-left": [path("m15 18-6-6 6-6")],
  "octagon-alert": [path("M12 16h.01"), path("M12 8v4"), path("M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z")],
  "sliders": [path("M4 21v-7"), path("M4 10V3"), path("M12 21v-9"), path("M12 8V3"), path("M20 21v-5"), path("M20 12V3"), path("M2 14h4"), path("M10 8h4"), path("M18 16h4")],
} satisfies Record<string, IconNode[]>;

export type IconName = keyof typeof ICONS;

const KIT_ICONS: Record<string, IconName> = {
  "resume-career": "file-user",
  "web-app": "globe",
  "data-analysis": "bar-chart",
  "docs-reports": "file-text",
  "marketing-content": "megaphone",
  "research-monitoring": "radar",
  "ui-design": "palette",
  "workflow-automation": "workflow",
};

// A kit added to the catalog later gets a neutral icon until it is given its own.
export function kitIcon(kitId: string): IconName {
  return KIT_ICONS[kitId] ?? "layers";
}
