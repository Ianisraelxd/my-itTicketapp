// Help articles: admins write them, everyone reads them, and the chatbot suggests them.
import { query } from "./db.js";

const STOP_WORDS = new Set(
  "the and for with that this have has not but are was were you your can cant cannot how what when where why who will would should could from into onto about there their then than too very just also its it's i'm please help need want does doesnt won't wont my me our we they them his her she him all any some more most been being get got out off over under again still ayaw hindi ang ng mga sa na po ko ako".split(" "),
);

export const tokens = (text) =>
  [...new Set(String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter((word) => word.length >= 3 && !STOP_WORDS.has(word)))];

/** How well one article fits the words typed (pure, so it can be unit tested). */
export function scoreArticle(article, words, category = null) {
  const title = article.title.toLowerCase();
  const keywords = ` ${String(article.keywords ?? "").toLowerCase()} `;
  const text = `${article.summary ?? ""} ${article.body ?? ""}`.toLowerCase();
  let score = 0;
  for (const word of words) {
    if (title.includes(word)) score += 4;
    if (keywords.includes(` ${word} `) || keywords.includes(word)) score += 3;
    if (text.includes(word)) score += 1;
  }
  if (score > 0 && category && article.category === category) score += 2;
  return score;
}

/** Published articles that match the text, best first. Used by the chatbot and the search box. */
export async function searchArticles(text, { category = null, limit = 3 } = {}) {
  const words = tokens(text);
  const articles = await query(
    "SELECT article_pk AS id, title, category, summary, body, keywords FROM kb_articles WHERE published = 1",
  );
  if (words.length === 0) return articles.filter((a) => category && a.category === category).slice(0, limit);
  return articles
    .map((article) => ({ article, score: scoreArticle(article, words, category) }))
    .filter((item) => item.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.article);
}

export async function getPublishedArticle(id) {
  const rows = await query("SELECT article_pk AS id, title, category, summary, body FROM kb_articles WHERE article_pk = ? AND published = 1 LIMIT 1", [Number(id) || 0]);
  if (rows[0]) await query("UPDATE kb_articles SET views = views + 1 WHERE article_pk = ?", [rows[0].id]);
  return rows[0] ?? null;
}

export async function recordFeedback(id, helpful) {
  const column = helpful ? "helpful_yes" : "helpful_no";
  await query(`UPDATE kb_articles SET ${column} = ${column} + 1 WHERE article_pk = ? AND published = 1`, [Number(id) || 0]);
}

const ADMIN_ROLES = ["admin", "superadmin"];
const CATEGORIES = ["General", "Hardware", "Software", "Network / Internet", "Account / Login", "Printer", "Others"];

export function registerKbRoutes(app, { wrap }) {
  const manageOnly = (req, res) => {
    if (!ADMIN_ROLES.includes(req.user.role)) {
      res.status(403).json({ error: "Only admins can edit help articles." });
      return false;
    }
    return true;
  };

  const readArticle = (body) => {
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const text = typeof body?.body === "string" ? body.body.trim() : "";
    if (!title || title.length > 160) return { error: "Give the article a title of up to 160 characters." };
    if (!text || text.length > 8000) return { error: "The article text is required (up to 8000 characters)." };
    const category = CATEGORIES.includes(body?.category) ? body.category : "General";
    const summary = String(body?.summary ?? "").trim().slice(0, 300);
    const keywords = String(body?.keywords ?? "").trim().slice(0, 300);
    return { title, text, category, summary, keywords, published: body?.published === false ? 0 : 1 };
  };

  // Search or list. Requesters and agents only see published articles.
  app.get("/api/kb", wrap(async (req, res) => {
    const canManage = ADMIN_ROLES.includes(req.user.role);
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const category = typeof req.query.category === "string" && req.query.category ? req.query.category : null;
    const rows = await query(
      `SELECT article_pk AS id, title, category, summary, body, keywords, published, views,
         helpful_yes AS helpfulYes, helpful_no AS helpfulNo, updated_at AS updatedAt
       FROM kb_articles WHERE ${canManage ? "1 = 1" : "published = 1"} ORDER BY category, title`,
    );
    let list = category ? rows.filter((row) => row.category === category) : rows;
    const words = tokens(q);
    if (words.length > 0) {
      list = list
        .map((article) => ({ article, score: scoreArticle(article, words) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((item) => item.article);
    }
    res.json(list.slice(0, 100));
  }));

  app.get("/api/kb/:id", wrap(async (req, res) => {
    const canManage = ADMIN_ROLES.includes(req.user.role);
    const rows = await query(
      `SELECT article_pk AS id, title, category, summary, body, keywords, published, views,
         helpful_yes AS helpfulYes, helpful_no AS helpfulNo, updated_at AS updatedAt
       FROM kb_articles WHERE article_pk = ? ${canManage ? "" : "AND published = 1"} LIMIT 1`,
      [Number(req.params.id) || 0],
    );
    if (!rows[0]) return res.status(404).json({ error: "Article not found." });
    await query("UPDATE kb_articles SET views = views + 1 WHERE article_pk = ?", [rows[0].id]);
    res.json(rows[0]);
  }));

  app.post("/api/kb", wrap(async (req, res) => {
    if (!manageOnly(req, res)) return;
    const a = readArticle(req.body);
    if (a.error) return res.status(400).json({ error: a.error });
    const rows = await query(
      "INSERT INTO kb_articles (title, category, summary, body, keywords, published, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [a.title, a.category, a.summary, a.text, a.keywords, a.published, req.user.userId],
    );
    await query("INSERT INTO activities (actor_name, actor_role, action) VALUES (?, ?, ?)", [req.user.name, req.user.roleName, `Published help article "${a.title}"`]);
    res.status(201).json({ ok: true, id: rows.insertId });
  }));

  app.put("/api/kb/:id", wrap(async (req, res) => {
    if (!manageOnly(req, res)) return;
    const a = readArticle(req.body);
    if (a.error) return res.status(400).json({ error: a.error });
    const rows = await query(
      "UPDATE kb_articles SET title = ?, category = ?, summary = ?, body = ?, keywords = ?, published = ? WHERE article_pk = ?",
      [a.title, a.category, a.summary, a.text, a.keywords, a.published, Number(req.params.id) || 0],
    );
    if (rows.affectedRows === 0) return res.status(404).json({ error: "Article not found." });
    await query("INSERT INTO activities (actor_name, actor_role, action) VALUES (?, ?, ?)", [req.user.name, req.user.roleName, `Edited help article "${a.title}"`]);
    res.json({ ok: true });
  }));

  app.delete("/api/kb/:id", wrap(async (req, res) => {
    if (!manageOnly(req, res)) return;
    const found = await query("SELECT title FROM kb_articles WHERE article_pk = ?", [Number(req.params.id) || 0]);
    if (!found[0]) return res.status(404).json({ error: "Article not found." });
    await query("DELETE FROM kb_articles WHERE article_pk = ?", [Number(req.params.id)]);
    await query("INSERT INTO activities (actor_name, actor_role, action) VALUES (?, ?, ?)", [req.user.name, req.user.roleName, `Deleted help article "${found[0].title}"`]);
    res.json({ ok: true });
  }));

  // "Did this help?" Anyone signed in may answer once per click; the numbers only guide the admins.
  app.post("/api/kb/:id/feedback", wrap(async (req, res) => {
    if (typeof req.body?.helpful !== "boolean") return res.status(400).json({ error: "helpful must be true or false." });
    const column = req.body.helpful ? "helpful_yes" : "helpful_no";
    const result = await query(`UPDATE kb_articles SET ${column} = ${column} + 1 WHERE article_pk = ? AND published = 1`, [Number(req.params.id) || 0]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Article not found." });
    res.json({ ok: true });
  }));
}

export const KB_CATEGORIES = CATEGORIES;
