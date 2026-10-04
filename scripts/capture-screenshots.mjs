// Captures the README screenshots with a real browser (Edge/Chrome via puppeteer-core).
//
// Run it against an app whose database was filled by scripts/seed-demo-data.mjs:
//   node scripts/capture-screenshots.mjs http://localhost:5175
// Set CHROME_PATH if your browser is not Microsoft Edge in the default location.
import fs from "node:fs";
import path from "node:path";

import puppeteer from "puppeteer-core";

const BASE = (process.argv[2] || "http://localhost:5175").replace(/\/$/, "");
const OUT = path.resolve("docs/screenshots");
const BROWSER =
  process.env.CHROME_PATH ||
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].find((candidate) => fs.existsSync(candidate));
if (!BROWSER) throw new Error("No browser found. Set CHROME_PATH.");

fs.mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1 };
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({ executablePath: BROWSER, headless: true });

async function open({ theme = "light", viewport = DESKTOP } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(viewport);
  // Quiet, predictable settings for every shot.
  await page.evaluateOnNewDocument((chosenTheme) => {
    localStorage.setItem(
      "helpdesk-settings-v1",
      JSON.stringify({ muted: true, volume: 0.8, theme: chosenTheme, motion: "on" }),
    );
  }, theme);
  return { context, page };
}

async function clickText(page, selector, text) {
  const clicked = await page.evaluate(
    (sel, wanted) => {
      const element = [...document.querySelectorAll(sel)].find(
        (candidate) => candidate.textContent.replace(/\s+/g, " ").includes(wanted) && candidate.offsetParent !== null,
      );
      if (!element) return false;
      element.click();
      return true;
    },
    selector,
    text,
  );
  if (!clicked) throw new Error(`Nothing matched ${selector} containing "${text}"`);
}

async function login(page, role, password) {
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await page.type("input[type=text]", "2404154");
  await page.type("input[type=password]", password);
  await page.select("select", role);
  await page.click("button[type=submit]");
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".sidebar .nav-list button, .bottom-nav button")].some(
      (button) => button.getClientRects().length > 0,
    ),
  );
  await sleep(1500);
}

async function nav(page, label, wait = 1800) {
  await clickText(page, ".sidebar .nav-list button, .bottom-nav button", label);
  await sleep(wait);
}

async function shot(page, name, { wait = 400 } = {}) {
  await sleep(wait);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log("captured", name);
}

async function closeTopModal(page) {
  await page.evaluate(() => {
    const close =
      document.querySelector(".ticket-duo-close") ||
      document.querySelector(".modal-close") ||
      [...document.querySelectorAll(".modal-box button")].find((b) => /Cancel|Back|Close|Okay/.test(b.textContent));
    close?.click();
  });
  await sleep(500);
}

async function openTicket(page, subjectPart) {
  await page.evaluate((part) => {
    const row = [...document.querySelectorAll("tbody tr")].find((r) => r.textContent.includes(part));
    row.querySelector(".table-button").click();
  }, subjectPart);
  await sleep(1800);
}

const api = (route, body) =>
  fetch(`${BASE}/api${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// ------------------------------------------------------------------ login screens
{
  const { context, page } = await open();
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await shot(page, "01-login", { wait: 1500 });
  await context.close();
}
{
  const { context, page } = await open({ theme: "dark" });
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await shot(page, "02-login-dark", { wait: 1500 });
  await context.close();
}

// ------------------------------------------------------------------ student (light)
{
  const { context, page } = await open();
  await login(page, "student", "123456student");
  await shot(page, "03-student-dashboard");

  await nav(page, "Submit Request");
  await page.select(".request-form select", "Hardware");
  await page.type(".request-form input[placeholder^='Example: Cannot']", "Projector flickers during class");
  await page.type(".request-form input[placeholder^='Example: Computer']", "Computer Laboratory 2");
  await page.type(".request-form textarea", "The image flickers and turns off every few minutes. It started this morning.");
  await shot(page, "04-submit-request");

  await nav(page, "My Requests");
  await shot(page, "05-my-requests");

  await openTicket(page, "Projector in Lab 1");
  await shot(page, "06-ticket-details-chat");
  await closeTopModal(page);

  await openTicket(page, "Wi-Fi keeps dropping");
  await shot(page, "07-cancellation-requested");
  await closeTopModal(page);

  await openTicket(page, "Office 365");
  await clickText(page, ".ticket-chat-head button", "Reopen");
  await sleep(600);
  await shot(page, "08-reopen-warning");
  await closeTopModal(page);
  await closeTopModal(page);

  await nav(page, "Notifications");
  await shot(page, "09-notifications");

  await page.click(".settings-button");
  await sleep(700);
  await shot(page, "10-settings");
  await clickText(page, ".settings-actions button", "About");
  await sleep(600);
  await shot(page, "11-about");
  await context.close();
}

// ------------------------------------------------------------------ student (dark)
{
  const { context, page } = await open({ theme: "dark" });
  await login(page, "student", "123456student");
  await shot(page, "12-student-dashboard-dark");
  await nav(page, "My Requests");
  await openTicket(page, "Projector in Lab 1");
  await shot(page, "13-ticket-details-dark");
  await context.close();
}

// ------------------------------------------------------------------ phone
{
  const { context, page } = await open({ viewport: MOBILE });
  await login(page, "student", "123456student");
  await shot(page, "14-mobile-dashboard");
  await nav(page, "My Requests");
  await openTicket(page, "Projector in Lab 1");
  await shot(page, "15-mobile-ticket-chat");
  await clickText(page, ".ticket-tabs button", "Details");
  await shot(page, "16-mobile-ticket-details");
  await closeTopModal(page);
  await nav(page, "Notifications");
  await shot(page, "17-mobile-notifications");
  await context.close();
}

// ------------------------------------------------------------------ technician
{
  const { context, page } = await open();
  await login(page, "technician", "123456technician");
  await shot(page, "18-technician-dashboard");
  await nav(page, "Assigned Requests");
  await shot(page, "19-technician-queue");
  // Resolve a ticket outside this technician's skills -> risk warning
  await page.evaluate(() => {
    const row = [...document.querySelectorAll("tbody tr")].find(
      (r) => r.textContent.includes("Outside your skills") && !r.querySelector(".table-button:disabled"),
    );
    [...row.querySelectorAll(".table-button")].find((b) => b.textContent.includes("Resolve")).click();
  });
  await sleep(700);
  await shot(page, "20-out-of-skill-warning");
  await context.close();
}

// ------------------------------------------------------------------ admin
{
  const { context, page } = await open();
  await login(page, "admin", "123456admin");
  await nav(page, "Manage Requests");
  await shot(page, "21-admin-manage-requests");

  await page.evaluate(() => {
    const row = [...document.querySelectorAll("tbody tr")].find(
      (r) => r.textContent.includes("MATLAB"),
    );
    [...row.querySelectorAll(".table-button")].find((b) => b.textContent.includes("Assign")).click();
  });
  await sleep(700);
  await shot(page, "22-assign-technician");
  await closeTopModal(page);

  await nav(page, "Users");
  await shot(page, "23-users-and-skills");

  await nav(page, "Password Requests");
  await shot(page, "24-password-requests");

  // Chat dock: the technician has already written, the admin answers.
  await api("/messages", {
    senderId: 3,
    recipientId: 4,
    body: "Hi! I am heading to Lab 1 to look at the projector now.",
  });
  await sleep(500);
  await page.click(".chat-launcher");
  await sleep(700);
  await clickText(page, ".chat-contact", "Technician User");
  await sleep(1200);
  await page.type(".chat-window .chat-compose textarea", "Great, thank you! Please update the ticket when it is done.");
  await page.keyboard.press("Enter");
  await sleep(1200);
  await shot(page, "25-chat-dock");
  await context.close();
}

// ------------------------------------------------------------------ super admin
{
  const { context, page } = await open();
  await login(page, "superadmin", "123456superadmin");
  await shot(page, "26-superadmin-dashboard");

  await nav(page, "Report Manager", 3200);
  await page.setViewport({ ...DESKTOP, height: 2250 });
  await sleep(1200);
  await shot(page, "27-report-manager");
  await page.setViewport(DESKTOP);

  await nav(page, "Activity Log Reports");
  await shot(page, "28-activity-log");
  await context.close();
}
{
  const { context, page } = await open({ theme: "dark" });
  await login(page, "superadmin", "123456superadmin");
  await nav(page, "Report Manager", 3200);
  await page.setViewport({ ...DESKTOP, height: 2250 });
  await sleep(1200);
  await shot(page, "29-report-manager-dark");
  await context.close();
}

await browser.close();
console.log("Done. Screenshots are in", OUT);
