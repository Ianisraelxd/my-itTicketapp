// Photos on tickets: a requester can show the problem (a broken screen, an error message), and
// agents can send a picture back. Files are checked by their content (not their name), size
// limited, stored under random names in server/uploads and only served to people on the ticket.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { logEvent } from "./audit.js";
import { pool, query } from "./db.js";

export const UPLOAD_DIR = fileURLToPath(new URL("./uploads", import.meta.url));
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS_PER_TICKET = 8;

/** The picture type from the first bytes of the file, or null when it is not a PNG, JPEG, GIF or WebP. */
export function sniffImage(buffer) {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer.toString("ascii", 1, 4) === "PNG") return { mime: "image/png", ext: ".png" };
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: "image/jpeg", ext: ".jpg" };
  if (buffer.toString("ascii", 0, 4) === "GIF8") return { mime: "image/gif", ext: ".gif" };
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", ext: ".webp" };
  return null;
}

export const cleanFileName = (name) =>
  path.basename(String(name ?? "photo")).replace(/[^\p{L}\p{N}._ -]/gu, "").trim().slice(0, 120) || "photo";

export function registerAttachmentRoutes(app, { wrap, ticketAccess, notify, adminIds, publishTicket, closedStatuses }) {
  // Add a photo. Body: { name, data } where data is the file as base64 (a data: URL is fine too).
  app.post("/api/tickets/:id/attachments", wrap(async (req, res) => {
    const access = await ticketAccess(req.params.id, req.body?.userId);
    if (access.error) return res.status(access.error[0]).json({ error: access.error[1] });
    const { ticket, user } = access;
    if (closedStatuses.includes(ticket.status)) {
      return res.status(409).json({ error: `This ticket is ${ticket.status.toLowerCase()}, so photos can no longer be added.` });
    }
    if (typeof req.body?.data !== "string" || req.body.data.length === 0) {
      return res.status(400).json({ error: "Choose a photo to add." });
    }
    const [{ n }] = await query("SELECT COUNT(*) AS n FROM ticket_attachments WHERE ticket_pk = ?", [ticket.ticket_pk]);
    if (Number(n) >= MAX_PHOTOS_PER_TICKET) {
      return res.status(409).json({ error: `A ticket can have up to ${MAX_PHOTOS_PER_TICKET} photos.` });
    }

    const buffer = Buffer.from(req.body.data.replace(/^data:[^,]*,/, ""), "base64");
    if (buffer.length === 0) return res.status(400).json({ error: "The photo is empty." });
    if (buffer.length > MAX_PHOTO_BYTES) {
      return res.status(413).json({ error: `Photos can be up to ${MAX_PHOTO_BYTES / 1024 / 1024} MB.` });
    }
    const type = sniffImage(buffer);
    if (!type) return res.status(400).json({ error: "Only PNG, JPEG, GIF and WebP pictures can be added." });

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const stored = `${crypto.randomUUID()}${type.ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, stored), buffer, { flag: "wx" });
    const original = cleanFileName(req.body.name);

    const [saved] = await pool.execute(
      "INSERT INTO ticket_attachments (ticket_pk, uploaded_by, original_name, stored_name, mime, size_bytes) VALUES (?, ?, ?, ?, ?, ?)",
      [ticket.ticket_pk, user.user_pk, original, stored, type.mime, buffer.length],
    );
    const attachmentId = saved.insertId;
    // The photo appears in the conversation like a message.
    await query(
      "INSERT INTO ticket_messages (ticket_pk, sender_pk, message_text, kind, meta) VALUES (?, ?, ?, 'attachment', ?)",
      [ticket.ticket_pk, user.user_pk, original, JSON.stringify({ attachmentId, mime: type.mime })],
    );
    await logEvent({
      ticketPk: ticket.ticket_pk,
      actor: { userId: user.user_pk, name: user.name, roleName: user.role_name },
      action: "attachment_added",
      detail: original,
    });
    const others = [ticket.created_by, ticket.assigned_to, ...(await adminIds())].filter((id) => id && id !== user.user_pk);
    await notify(others, {
      type: "message",
      title: `New photo on ${ticket.code}`,
      body: `${user.name} added a photo: ${original}`,
      ticketCode: ticket.code,
    });
    await publishTicket(ticket);
    res.status(201).json({ ok: true, id: attachmentId, name: original, mime: type.mime });
  }));

  app.get("/api/tickets/:id/attachments", wrap(async (req, res) => {
    const access = await ticketAccess(req.params.id, req.query.userId);
    if (access.error) return res.status(access.error[0]).json({ error: access.error[1] });
    const rows = await query(
      "SELECT attachment_pk AS id, original_name AS name, mime, size_bytes AS size, created_at AS createdAt FROM ticket_attachments WHERE ticket_pk = ? ORDER BY attachment_pk",
      [access.ticket.ticket_pk],
    );
    res.json(rows);
  }));

  // The picture itself. Only people on the ticket may fetch it.
  app.get("/api/attachments/:attachmentId", wrap(async (req, res) => {
    const rows = await query(
      "SELECT a.stored_name, a.mime, a.original_name, t.code FROM ticket_attachments a JOIN tickets t ON t.ticket_pk = a.ticket_pk WHERE a.attachment_pk = ? LIMIT 1",
      [Number(req.params.attachmentId) || 0],
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: "Photo not found." });
    const access = await ticketAccess(row.code, req.query.userId);
    if (access.error) return res.status(access.error[0]).json({ error: access.error[1] });
    const file = path.join(UPLOAD_DIR, path.basename(row.stored_name));
    if (!fs.existsSync(file)) return res.status(404).json({ error: "The photo file is no longer on the server." });
    res.set({
      "Content-Type": row.mime,
      "Content-Disposition": `inline; filename="${encodeURIComponent(row.original_name)}"`,
      "Cache-Control": "private, max-age=3600",
      "Content-Security-Policy": "default-src 'none'",
    });
    fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
  }));
}
