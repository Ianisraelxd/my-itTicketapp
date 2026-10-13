// Browser walk-through: signs in as every role, opens every page on a desktop and a phone screen and
// reports console errors, failed requests, horizontal overflow and controls without a name.
//   node scripts/qa-ui.mjs http://localhost:5173
// Use a demo database (it only reads, apart from signing in).
import fs from "node:fs";

import puppeteer from "puppeteer-core";

const BASE = (process.argv[2] || "http://localhost:5173").replace(/\/$/, "");
const BROWSER = process.env.CHROME_PATH ||
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].find((candidate) => fs.existsSync(candidate));
if (!BROWSER) throw new Error("No browser found. Set CHROME_PATH.");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ROLES = [
  ["student", "123456student"],
  ["staff", "123456employee"],
  ["agent", "123456technician"],
  ["admin", "123456admin"],
  ["superadmin", "123456superadmin"],
  ["report_viewer", "123456viewer"],
];
const SCREENS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

const browser = await puppeteer.launch({ executablePath: BROWSER, headless: true });
const problems = [];
let pagesChecked = 0;

for (const [screenName, viewport] of Object.entries(SCREENS)) {
  for (const [role, password] of ROLES) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport(viewport);
    await page.evaluateOnNewDocument(() =>
      localStorage.setItem("helpdesk-settings-v1", JSON.stringify({ muted: true, volume: 0.5, theme: "light", motion: "on" })),
    );
    let where = "login";
    const note = (kind, detail) => problems.push(`${screenName}/${role}/${where}: ${kind} ${detail}`);
    page.on("pageerror", (error) => note("JS error", error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !/Failed to load resource.*(401|403|404|409)/.test(message.text())) note("console", message.text().slice(0, 140));
    });
    page.on("response", (response) => {
      if (response.status() >= 500) note("HTTP " + response.status(), response.url().replace(BASE, ""));
    });

    await page.goto(BASE, { waitUntil: "networkidle0" });
    await page.type("input[type=text]", "2404154");
    await page.type("input[type=password]", password);
    await page.select("select", role);
    await page.click("button[type=submit]");
    try {
      await page.waitForFunction(
        () => [...document.querySelectorAll(".sidebar .nav-list button, .bottom-nav button")].some((b) => b.getClientRects().length > 0),
        { timeout: 10000 },
      );
    } catch {
      note("login failed", "no navigation appeared");
      await context.close();
      continue;
    }
    await sleep(1200);

    const labels = await page.$$eval(".sidebar .nav-list button, .bottom-nav button", (buttons) =>
      [...new Set(buttons.filter((b) => b.getClientRects().length > 0).map((b) => b.textContent.replace(/\s+/g, " ").trim()))],
    );
    for (const label of labels) {
      where = label;
      await page.evaluate((text) => {
        const target = [...document.querySelectorAll(".sidebar .nav-list button, .bottom-nav button")].find(
          (b) => b.getClientRects().length > 0 && b.textContent.replace(/\s+/g, " ").trim() === text,
        );
        target?.click();
      }, label);
      await sleep(1100);
      pagesChecked += 1;

      const audit = await page.evaluate(() => {
        const overflow = document.documentElement.scrollWidth - window.innerWidth;
        const wide = overflow > 1
          ? [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && el.getClientRects().length).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`)
          : [];
        const unnamed = [...document.querySelectorAll("button, a, input, select, textarea")]
          .filter((el) => el.getClientRects().length && !el.closest("[aria-hidden=true]"))
          .filter((el) => {
            const name = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.getAttribute("title") || "").trim();
            const labelled = el.labels?.length > 0 || el.closest("label");
            return !name && !labelled;
          })
          .slice(0, 3)
          .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`);
        const empty = document.querySelector(".page")?.textContent.trim().length === 0;
        return { overflow, wide, unnamed, empty };
      });
      if (audit.overflow > 1) note("horizontal overflow", `${audit.overflow}px (${audit.wide.join(", ")})`);
      if (audit.unnamed.length) note("controls without a name", audit.unnamed.join(", "));
      if (audit.empty) note("blank page", "");
    }
    await context.close();
  }
}
await browser.close();

console.log(`Checked ${pagesChecked} page views.`);
const unique = [...new Set(problems)];
if (unique.length === 0) console.log("No problems found.");
else {
  console.log(`${unique.length} problem(s):`);
  for (const line of unique) console.log(" -", line);
}
process.exit(unique.length ? 1 : 0);
