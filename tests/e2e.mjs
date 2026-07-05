import pkg from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pkg;
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = "http://localhost:8123";
const shot = (name) => join(here, "..", "..", "predict2-shots", name);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1600 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });

// Upload the CSV (default: realistic sample; pass a filename to override).
const csvFile = process.argv[2] || "sample.csv";
await page.setInputFiles("#file", join(here, csvFile));
await page.waitForSelector("#file-meta:not(:empty)");
const meta = await page.textContent("#file-meta");
console.log("meta:", meta.trim());

async function runModel(modelId, label) {
  await page.selectOption("#model", modelId);
  await page.click("#run");
  await page.waitForFunction(() => document.querySelector("#run").textContent === "Lancer la détection");
  const stats = await page.$$eval("#stats .stat", (els) =>
    els.map((e) => e.textContent.replace(/\s+/g, " ").trim())
  );
  const rows = await page.$$eval("#anomaly-table tr", (r) => r.length);
  const cleanVisible = await page.isVisible("#chart-clean-block");
  console.log(`\n[${label}]`);
  console.log("  stats:", stats.join(" | "));
  console.log("  table rows (incl header):", rows, "| cleaned chart visible:", cleanVisible);
  await page.screenshot({ path: shot(`${modelId}.png`), fullPage: true });
}

await runModel("zscore", "Z-Score");
await runModel("isolation_forest", "Isolation Forest");

// Hover to verify tooltip.
const box = await page.$eval("#chart-main .hit", (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width * 0.15, y: r.y + r.height / 2 };
});
await page.mouse.move(box.x, box.y);
await page.waitForTimeout(150);
const tipVisible = await page.$eval("#chart-main .chart-tip", (el) => getComputedStyle(el).opacity);
console.log("\ntooltip opacity on hover:", tipVisible);

console.log("\nconsole errors:", errors.length ? errors : "none");
await browser.close();
process.exit(errors.length ? 1 : 0);
