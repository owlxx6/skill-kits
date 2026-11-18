// Share images (1200 x 630 PNG) drawn at build time: satori lays the card out as SVG, resvg turns it into a PNG.
// Inter ships with the build (@fontsource/inter), so the result does not depend on fonts installed on the machine.
import { readFileSync } from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

export interface ShareCard {
  eyebrow: string;
  // A list puts each entry on its own line and colours every line after the first, like the home page headline.
  title: string | string[];
  lines: string[];
  footer: string;
}

type Node = { type: string; props: { style: Record<string, string | number>; children?: Array<Node | string> | string } };

const h = (style: Record<string, string | number>, children?: Array<Node | string> | string): Node => ({
  type: "div",
  props: { style: { display: "flex", ...style }, children },
});

// The build runs from the repository root, where node_modules lives.
const fontFile = (weight: 600 | 700) => readFileSync(path.join(process.cwd(), "node_modules", "@fontsource", "inter", "files", `inter-latin-${weight}-normal.woff`));

const GREEN = "#5fcb9c";
const MUTED = "#a3aca7";

function layout(card: ShareCard): Node {
  const titleLines = Array.isArray(card.title) ? card.title : [card.title];
  const longest = Math.max(...titleLines.map((line) => line.length));
  return h(
    {
      // border-box keeps the 72 px padding inside the 1200 x 630 canvas; without it the footer falls off the bottom.
      boxSizing: "border-box", flexDirection: "column", justifyContent: "space-between", width: 1200, height: 630, padding: 72, color: "#f4f6f5", fontFamily: "Inter", backgroundColor: "#0d1210",
      backgroundImage: "radial-gradient(circle at 12% 0%, rgba(40,160,120,0.5), rgba(13,18,16,0) 55%), radial-gradient(circle at 100% 100%, rgba(15,100,75,0.6), rgba(13,18,16,0) 50%)",
    },
    [
      h({ alignItems: "center", gap: 16 }, [h({ width: 30, height: 30, backgroundColor: GREEN }), h({ fontSize: 34, fontWeight: 700 }, "Skill Kits")]),
      h({ flexDirection: "column", gap: 20 }, [
        h({ fontSize: 26, fontWeight: 600, color: GREEN }, card.eyebrow),
        h(
          { flexDirection: "column", fontSize: longest > 28 ? 76 : 88, fontWeight: 700, lineHeight: 1.02, letterSpacing: -3, maxWidth: 1056 },
          titleLines.map((line, position) => h({ color: position === 0 ? "#f4f6f5" : GREEN }, line)),
        ),
        ...(card.lines.length > 0 ? [h({ flexDirection: "column", gap: 10, marginTop: 14 }, card.lines.map((line) => h({ fontSize: 30, color: MUTED }, line)))] : []),
      ]),
      h({ fontSize: 28, fontWeight: 600, color: MUTED }, card.footer),
    ],
  );
}

export async function renderShareCard(card: ShareCard): Promise<Uint8Array> {
  const svg = await satori(layout(card) as never, {
    width: 1200,
    height: 630,
    fonts: [
      { name: "Inter", data: fontFile(600), weight: 600, style: "normal" },
      { name: "Inter", data: fontFile(700), weight: 700, style: "normal" },
    ],
  });
  return new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
}
