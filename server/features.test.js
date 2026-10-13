import assert from "node:assert/strict";
import test from "node:test";

import { cleanFileName, sniffImage } from "./attachments.js";
import { scoreArticle, tokens } from "./kb.js";
import { buildAlertMail, mailMode } from "./mailer.js";
import { rateLimit } from "./ratelimit.js";

test("sniffImage recognises pictures by content, not by name", () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
  assert.equal(sniffImage(png).mime, "image/png");
  assert.equal(sniffImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(12)])).mime, "image/jpeg");
  assert.equal(sniffImage(Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(12)])).mime, "image/gif");
  assert.equal(sniffImage(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(4)])).mime, "image/webp");
  assert.equal(sniffImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), null);
  assert.equal(sniffImage(Buffer.from("<html><script>alert(1)</script></html>")), null);
  assert.equal(sniffImage(Buffer.alloc(3)), null);
});

test("cleanFileName drops folders and odd characters", () => {
  assert.equal(cleanFileName("../../etc/passwd"), "passwd");
  assert.equal(cleanFileName("My photo (1).png"), "My photo 1.png");
  assert.equal(cleanFileName(""), "photo");
  assert.equal(cleanFileName("x".repeat(500)).length, 120);
});

test("help article search ranks the right article first", () => {
  const wifi = { title: "Cannot connect to campus Wi-Fi", category: "Network / Internet", summary: "Reconnect", body: "Forget the network", keywords: "wifi wireless internet" };
  const printer = { title: "Printer will not print", category: "Printer", summary: "Check paper", body: "Clear the queue", keywords: "printer print paper jam" };
  const words = tokens("my wifi keeps disconnecting from the wireless network");
  assert.ok(words.includes("wifi") && !words.includes("the") && !words.includes("my"));
  assert.ok(scoreArticle(wifi, words) > scoreArticle(printer, words));
  assert.equal(scoreArticle(printer, tokens("zzzz qqqq")), 0);
  // a matching category gives a small boost, but never makes an unrelated article match
  assert.ok(scoreArticle(wifi, words, "Network / Internet") > scoreArticle(wifi, words));
  assert.equal(scoreArticle(printer, tokens("zzzz"), "Printer"), 0);
});

test("alert emails are built safely", () => {
  const mail = buildAlertMail({ title: "New <b>ticket</b>", body: 'Fix "it" & go', ticketCode: "#HD001" }, "https://help.example.edu");
  assert.equal(mail.subject, "[HelpDesk] New <b>ticket</b> (#HD001)");
  assert.ok(mail.text.includes("https://help.example.edu") && mail.text.includes("#HD001"));
  assert.ok(!mail.html.includes("<b>ticket</b>") && mail.html.includes("&lt;b&gt;ticket&lt;/b&gt;") && mail.html.includes("&amp;"));
});

test("mail mode follows the settings", () => {
  const saved = { host: process.env.SMTP_HOST, mode: process.env.MAIL_MODE };
  delete process.env.SMTP_HOST;
  delete process.env.MAIL_MODE;
  assert.equal(mailMode(), "off");
  process.env.SMTP_HOST = "smtp.example.edu";
  assert.equal(mailMode(), "smtp");
  process.env.MAIL_MODE = "log";
  assert.equal(mailMode(), "log");
  if (saved.host === undefined) delete process.env.SMTP_HOST;
  else process.env.SMTP_HOST = saved.host;
  if (saved.mode === undefined) delete process.env.MAIL_MODE;
  else process.env.MAIL_MODE = saved.mode;
});

test("the rate limiter answers 429 after the limit and resets with the window", async () => {
  const limit = rateLimit({ windowMs: 50, max: 2 });
  const run = () => {
    let status = 200;
    const res = { set() {}, status(code) { status = code; return this; }, json() {} };
    limit({ ip: "1.2.3.4" }, res, () => {});
    return status;
  };
  assert.deepEqual([run(), run(), run()], [200, 200, 429]);
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(run(), 200);
});

test("the archive spreadsheet is tidy and safe", async () => {
  const { csvCell, formatDateTime, ticketsToCsv } = await import("./csvExport.js");
  assert.equal(csvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(csvCell("=HYPERLINK(\"http://evil\")"), `"'=HYPERLINK(""http://evil"")"`);
  assert.equal(csvCell("-5"), '"-5"');
  assert.equal(csvCell("line one\nline two"), '"line one line two"');
  assert.equal(csvCell(null), '""');
  assert.equal(formatDateTime(new Date(2026, 9, 13, 14, 5)), "2026-10-13 14:05");
  assert.equal(formatDateTime(null), "");

  const csv = ticketsToCsv(
    [{ ticket_pk: 7, code: "#HD007", subject: "Wi-Fi, again", category: "Network / Internet", priority_tier: "P2", priority: "High", status: "Resolved", created_by: 1, assigned_to: 2, created_at: new Date(2026, 9, 13, 8, 0), resolved_at: new Date(2026, 9, 13, 9, 30), reopen_count: 0, csat_rating: 5, description: "+1 laptop" }],
    { people: new Map([[1, { name: "Ana", roleName: "Student" }], [2, { name: "Ben", roleName: "Agent" }]]), messageCounts: new Map([[7, 4]]) },
  );
  assert.ok(csv.startsWith("﻿\"Ticket\",\"Subject\""), "byte-order mark then readable headers");
  assert.ok(csv.includes("\r\n"));
  const row = csv.split("\r\n")[1];
  assert.ok(row.includes('"#HD007"') && row.includes('"Wi-Fi, again"') && row.includes('"Ana"') && row.includes('"Ben"'), row);
  assert.ok(row.includes('"2026-10-13 08:00"') && row.includes('"90"') && row.includes('"4"') && row.includes(`"'+1 laptop"`), row);
});

test("the rate limiter can count per person instead of per address", () => {
  const limit = rateLimit({ max: 1, key: (req) => req.user.id });
  const hit = (id) => {
    let status = 200;
    limit({ ip: "same", user: { id } }, { set() {}, status(code) { status = code; return this; }, json() {} }, () => {});
    return status;
  };
  assert.deepEqual([hit(1), hit(2), hit(1)], [200, 200, 429]);
});
