// Captures the README screenshots with a real browser (Edge/Chrome via puppeteer-core).
//
// Run it against an app whose database was filled by scripts/seed-demo-data.mjs:
//   node scripts/capture-screenshots.mjs http://localhost:5175
// Set CHROME_PATH if your browser is not Microsoft Edge in the default location.
import fs from "node:fs";
import os from "node:os";
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

// A made-up "photo of the problem" so the screenshots can show an attachment (no real picture is needed).
async function makeDemoPhoto() {
  const file = path.join(os.tmpdir(), "helpdesk-demo-photo.png");
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 640 });
  await page.setContent(
    `<body style="margin:0;height:100vh;display:grid;place-items:center;font-family:Arial,sans-serif;color:#cfe9df;background:#0b1512 repeating-linear-gradient(0deg,rgba(255,255,255,.05) 0 2px,transparent 2px 7px)">
      <div style="text-align:center"><div style="font-size:72px;font-weight:700;color:#e5484d;letter-spacing:4px">NO SIGNAL</div>
      <div style="margin-top:14px;font-size:28px">HDMI 1 &middot; Computer Laboratory projector</div></div></body>`,
  );
  await page.screenshot({ path: file });
  await page.close();
  return file;
}

async function fillRequestForm(page, { subject, description, photo }) {
  const choose = async (index, text) => {
    await page.evaluate(
      (i, wanted) => {
        const select = document.querySelectorAll("form.request-form select")[i];
        const option = [...select.options].find((o) => o.textContent.includes(wanted));
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      },
      index,
      text,
    );
    await sleep(150);
  };
  await choose(0, "Hardware");
  await choose(1, "My entire class");
  await choose(2, "Right now");
  await page.type("form.request-form input:not([type=hidden]):not([type=file])", subject);
  await choose(3, "Academic Zone");
  await choose(4, "IT Building");
  await choose(5, "Computer Laboratory 2");
  await page.type("form.request-form textarea", description);
  if (photo) {
    const input = await page.$(".photo-add input");
    await input.uploadFile(photo);
    await sleep(500);
  }
}

async function openTicket(page, subjectPart) {
  await page.evaluate((part) => {
    const row = [...document.querySelectorAll("tbody tr")].find((r) => r.textContent.includes(part));
    row.querySelector(".table-button").click();
  }, subjectPart);
  await sleep(1800);
}

// Direct API calls (the API needs a signed-in user, so sign in as the account that acts).
const ACCOUNTS = {
  agent: ["agent", "123456technician"],
  superadmin: ["superadmin", "123456superadmin"],
};
const tokens = {};
async function api(route, body, method = "POST", as = "superadmin") {
  if (!tokens[as]) {
    const [role, password] = ACCOUNTS[as];
    const response = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "2404154", role, password }),
    });
    tokens[as] = (await response.json()).token;
  }
  return fetch(`${BASE}/api${route}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens[as]}` },
    body: JSON.stringify(body),
  });
}

const demoPhoto = await makeDemoPhoto();

// Put the demo photo on a seeded ticket, sent by the agent, so the conversation shows an attachment.
async function addPhotoTo(subjectPart) {
  if (!tokens.agent) await api("/tickets/none/attachments", {}, "POST", "agent");
  const list = await (await fetch(`${BASE}/api/tickets`, { headers: { Authorization: `Bearer ${tokens.agent}` } })).json();
  const ticket = list.find((item) => item.subject.includes(subjectPart));
  await api(`/tickets/${encodeURIComponent(ticket.id)}/attachments`, { name: "projector-no-signal.png", data: fs.readFileSync(demoPhoto).toString("base64") }, "POST", "agent");
}
await addPhotoTo("Projector in Lab 1");

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
// Five wrong attempts: the page locks for 10 seconds; the next wrong attempt reveals "Forgot password?".
// (An ID that does not exist is used, so no real account is touched; the page counts the attempts itself.)
{
  const { context, page } = await open();
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await page.type("input[type=text]", "9999999");
  const wrongAttempt = async () => {
    await page.focus("input[type=password]");
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.type("input[type=password]", "wrong-pass");
    await page.click("button[type=submit]");
    await sleep(800);
    await closeTopModal(page);
  };
  for (let i = 0; i < 5; i += 1) await wrongAttempt();
  await shot(page, "33-login-cooldown", { wait: 600 });
  await sleep(10500);
  await wrongAttempt();
  await clickText(page, "button", "Forgot password?");
  await sleep(500);
  await page.type("input[type=email]", "student@campus.edu");
  await page.click("button[type=submit]");
  await shot(page, "34-forgot-password", { wait: 900 });
  await context.close();
}

// ------------------------------------------------------------------ student (light)
{
  const { context, page } = await open();
  await login(page, "student", "123456student");
  await shot(page, "03-student-dashboard");

  await nav(page, "Submit Request");
  await fillRequestForm(page, {
    subject: "Projector flickers during class",
    description: "The image flickers and turns off every few minutes. It started this morning.",
    photo: demoPhoto,
  });
  await page.setViewport({ ...DESKTOP, height: 1500 });
  await shot(page, "04-submit-request", { wait: 600 });
  await page.setViewport(DESKTOP);

  // A slow connection: six rapid clicks send one request and the page says it is working.
  await page.setRequestInterception(true);
  const hold = (request) => {
    if (request.method() === "POST" && /\/api\/tickets$/.test(request.url())) setTimeout(() => request.continue(), 7000);
    else request.continue();
  };
  page.on("request", hold);
  await page.evaluate(() => {
    const button = document.querySelector("form.request-form button[type=submit]");
    for (let i = 0; i < 6; i += 1) button.click();
  });
  await sleep(5200);
  await shot(page, "40-slow-connection", { wait: 100 });
  await sleep(3800);
  page.off("request", hold);
  await page.setRequestInterception(false);
  await clickText(page, ".modal-box button", "Okay");
  await sleep(400);

  // The assistant on the brand-new ticket
  await nav(page, "My Requests");
  await openTicket(page, "Projector flickers during class");
  await clickText(page, ".quick-replies button", "Try a quick fix");
  await sleep(1800);
  await clickText(page, ".quick-replies button", "Screen is blank or flickering");
  await sleep(1800);
  await shot(page, "36-assistant-chat");
  await closeTopModal(page);

  await nav(page, "My Requests");
  await shot(page, "05-my-requests");

  await openTicket(page, "Projector in Lab 1");
  await shot(page, "06-ticket-details-chat");
  await clickText(page, ".ticket-history summary", "History");
  await sleep(1200);
  await shot(page, "35-ticket-history");
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

  await nav(page, "Help Articles");
  await page.type(".help-search", "wifi");
  await sleep(1000);
  await clickText(page, ".help-head", "Wi-Fi");
  await sleep(500);
  await shot(page, "37-help-articles");

  // Profile > Email and text alerts
  await page.evaluate(() => [...document.querySelectorAll(".sidebar button")].find((b) => b.textContent.includes("Student User")).click());
  await sleep(600);
  await clickText(page, ".profile-actions button", "Email and text alerts");
  await sleep(900);
  await shot(page, "39-profile-alerts");
  await page.evaluate(() => document.querySelector("[aria-label='Close profile']")?.click());
  await sleep(400);

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

// ------------------------------------------------------------------ agent
{
  const { context, page } = await open();
  await login(page, "agent", "123456technician");
  await shot(page, "18-agent-dashboard");
  await nav(page, "Assigned Requests");
  await shot(page, "19-agent-queue");
  // Resolve a ticket outside this agent's skills -> risk warning
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
  await shot(page, "22-assign-agent");
  await closeTopModal(page);

  await nav(page, "Users");
  await shot(page, "23-users-and-skills");

  await nav(page, "Password Requests");
  await shot(page, "24-password-requests");

  await nav(page, "Help Articles");
  await clickText(page, "button", "New article");
  await sleep(500);
  await page.type(".help-editor input", "How to reset the classroom projector");
  await page.type(".help-editor textarea", "1. Turn the projector off and unplug it for one minute.\n2. Plug it back in and press the power button.\n3. Choose the HDMI input with the Source button.");
  await shot(page, "38-help-article-editor");
  await clickText(page, ".help-editor button", "Cancel");
  await sleep(400);

  // Chat dock: the agent has already written, the admin answers.
  await api(
    "/messages",
    { senderId: 3, recipientId: 4, body: "Hi! I am heading to Lab 1 to look at the projector now." },
    "POST",
    "agent",
  );
  await sleep(500);
  await page.click(".chat-launcher");
  await sleep(700);
  await clickText(page, ".chat-contact", "Agent User");
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
  // Pick this month's KPIs the way a super admin would, then show the scorecard.
  const thisMonth = new Date().toISOString().slice(0, 7);
  await api(
    "/kpi/selection",
    {
      userId: 5,
      month: thisMonth,
      metrics: ["AHT", "ART", "FRT", "SLA", "RR", "FCR", "REO", "BKL", "SKM"].map((key) => ({ key })),
    },
    "PUT",
  );
  // Leave and come back so the scorecard reloads with the new choice.
  await nav(page, "Activity Log Reports", 600);
  await nav(page, "Dashboard", 2200);
  await page.setViewport({ ...DESKTOP, height: 1500 });
  await sleep(1500);
  await shot(page, "26-superadmin-dashboard");
  await page.setViewport({ ...DESKTOP, height: 1100 });
  await sleep(500);
  await clickText(page, ".kpi-controls button", "Choose KPIs");
  await sleep(800);
  await shot(page, "30-kpi-picker");
  await closeTopModal(page);
  await page.setViewport(DESKTOP);

  // Super Admin panel: run one archive so the history has a row, then capture.
  await nav(page, "Super Admin Panel", 2500);
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  await page.evaluate((value) => {
    const input = document.querySelector('.gov-policy input[type="date"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, sixtyDaysAgo);
  await clickText(page, ".gov-actions button", "Check what would move");
  await sleep(1200);
  await clickText(page, ".gov-actions button", "Mass Export");
  await sleep(600);
  await page.type(".modal-box input", "ARCHIVE");
  await clickText(page, ".modal-box button", "Export & archive");
  await sleep(2500);
  await clickText(page, ".backup-panel button", "Back up now");
  await sleep(2500);
  await clickText(page, ".modal-box button", "Okay");
  await sleep(500);
  await page.setViewport({ ...DESKTOP, height: 2100 });
  await sleep(800);
  await shot(page, "32-super-admin-panel");
  await page.setViewport(DESKTOP);

  await nav(page, "Report Manager", 3200);
  await page.setViewport({ ...DESKTOP, height: 3000 });
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
  await page.setViewport({ ...DESKTOP, height: 3000 });
  await sleep(1200);
  await shot(page, "29-report-manager-dark");
  await nav(page, "Dashboard", 2500);
  await page.setViewport({ ...DESKTOP, height: 1500 });
  await sleep(1500);
  await shot(page, "31-superadmin-dashboard-dark");
  await context.close();
}

await browser.close();
console.log("Done. Screenshots are in", OUT);
