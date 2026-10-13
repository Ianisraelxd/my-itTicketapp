import { useCallback, useEffect, useState } from "react";

import { api } from "./api";

const CATEGORIES = ["General", "Hardware", "Software", "Network / Internet", "Account / Login", "Printer", "Others"];
const EMPTY = { title: "", category: "General", summary: "", keywords: "", body: "", published: true };

/**
 * Help articles for everyone; admins can also write, edit, hide and delete them.
 * The same articles are suggested by the HelpDesk Assistant in the ticket chat.
 */
export default function HelpArticles({ me, showMessage }) {
  const canManage = me.role === "admin" || me.role === "superadmin";
  const [articles, setArticles] = useState(null); // null while loading
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [openId, setOpenId] = useState(null);
  const [editor, setEditor] = useState(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [rated, setRated] = useState({});

  // Search as you type (after a short pause).
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      api
        .getArticles({ q: query, category })
        .then((rows) => active && (setArticles(rows), setFailed(false)))
        .catch(() => active && setFailed(true));
    }, query ? 250 : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, category, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);

  async function save(event) {
    event.preventDefault();
    try {
      if (editor.id) await api.updateArticle(editor.id, editor);
      else await api.createArticle(editor);
      showMessage("Saved", editor.published ? "The article is live." : "Saved as a draft: only admins can see it.");
      setEditor(null);
      reload();
    } catch (error) {
      showMessage("Could not save", error.message || "Please check the fields and try again.");
    }
  }

  async function remove(article) {
    if (!window.confirm(`Delete "${article.title}"? This cannot be undone.`)) return;
    try {
      await api.deleteArticle(article.id);
      reload();
    } catch (error) {
      showMessage("Could not delete", error.message || "Please try again.");
    }
  }

  async function rate(article, helpful) {
    setRated((current) => ({ ...current, [article.id]: helpful }));
    api.articleFeedback(article.id, helpful).catch(() => {});
  }

  return (
    <>
      <header className="page-header">
        <div>
          <span className="eyebrow">HELP / 05</span>
          <h1>Help articles</h1>
          <p>Quick answers to common problems. Still stuck? Submit a request and we will help.</p>
        </div>
        {canManage && (
          <button type="button" className="button button-primary" onClick={() => setEditor({ ...EMPTY })}>
            + New article
          </button>
        )}
      </header>

      <section className="panel help-panel">
        <div className="help-tools">
          <input
            type="search"
            className="help-search"
            placeholder="Search, for example: wifi, printer, password…"
            aria-label="Search help articles"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select aria-label="Filter by category" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </div>

        {failed && <p className="help-empty">The articles could not be loaded. Please try again.</p>}
        {!failed && articles === null && <div className="help-skeleton" aria-busy="true" />}
        {articles?.length === 0 && <p className="help-empty">No article matches. Try other words, or submit a request.</p>}

        <ul className="help-list">
          {(articles ?? []).map((article) => {
            const open = openId === article.id;
            return (
              <li key={article.id} className={open ? "open" : ""}>
                <button
                  type="button"
                  className="help-head"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : article.id)}
                >
                  <span>
                    <strong>{article.title}</strong>
                    {article.summary && <small>{article.summary}</small>}
                  </span>
                  <span className="help-tags">
                    <em>{article.category}</em>
                    {canManage && !article.published && <em className="draft">Draft</em>}
                  </span>
                </button>
                {open && (
                  <div className="help-body">
                    <p>{article.body}</p>
                    {canManage ? (
                      <div className="help-admin">
                        <small>
                          {article.views} views · {article.helpfulYes} helpful · {article.helpfulNo} not helpful
                        </small>
                        <button type="button" className="table-button" onClick={() => setEditor({ ...article })}>
                          Edit
                        </button>
                        <button type="button" className="table-button danger" onClick={() => remove(article)}>
                          Delete
                        </button>
                      </div>
                    ) : (
                      <div className="help-rate">
                        {rated[article.id] === undefined ? (
                          <>
                            <span>Did this help?</span>
                            <button type="button" className="table-button" onClick={() => rate(article, true)}>
                              Yes
                            </button>
                            <button type="button" className="table-button" onClick={() => rate(article, false)}>
                              No
                            </button>
                          </>
                        ) : (
                          <span>Thank you for the feedback.</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {editor && (
        <div className="modal-backdrop" onClick={() => setEditor(null)}>
          <form className="modal-box help-editor" onClick={(event) => event.stopPropagation()} onSubmit={save}>
            <h3>{editor.id ? "Edit article" : "New article"}</h3>
            <label className="field-label">
              Title
              <input value={editor.title} maxLength={160} required onChange={(event) => setEditor({ ...editor, title: event.target.value })} />
            </label>
            <div className="form-grid">
              <label className="field-label">
                Category
                <select value={editor.category} onChange={(event) => setEditor({ ...editor, category: event.target.value })}>
                  {CATEGORIES.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                Search words
                <input
                  value={editor.keywords}
                  maxLength={300}
                  placeholder="wifi wireless internet"
                  onChange={(event) => setEditor({ ...editor, keywords: event.target.value })}
                />
              </label>
            </div>
            <label className="field-label">
              One-line summary
              <input value={editor.summary} maxLength={300} onChange={(event) => setEditor({ ...editor, summary: event.target.value })} />
            </label>
            <label className="field-label">
              Article text
              <textarea rows={9} value={editor.body} maxLength={8000} required onChange={(event) => setEditor({ ...editor, body: event.target.value })} />
            </label>
            <label className="check-row">
              <input type="checkbox" checked={editor.published} onChange={(event) => setEditor({ ...editor, published: event.target.checked })} />
              Published (visible to everyone and suggested by the assistant)
            </label>
            <div className="modal-actions">
              <button type="button" className="button button-outline" onClick={() => setEditor(null)}>
                Cancel
              </button>
              <button type="submit" className="button button-primary">
                Save article
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
