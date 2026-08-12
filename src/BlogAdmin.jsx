// Blog Admin — staff CRUD for ssj.in's /blog articles (api/blog.js,
// blog_posts table). Replaces the old workflow of hand-editing
// ssj-website's src/blog/posts.js and redeploying per article — publishing
// or scheduling a post here is instant (or takes effect the moment
// published_at passes), no code deploy needed.
//
// Body content uses the same block-array shape the public site already
// renders: [{ h2 }, { h3 }, { p }, { ul: [...] }, { quote }]. The block
// editor below is a thin structured form over that shape, not a rich-text
// editor — keeps the data format identical to the code-authored articles
// already migrated in, so nothing downstream (FAQPage schema extraction,
// the public renderer) needs to change.

import { useState, useEffect, useCallback } from "react";

const CATEGORIES = ["Bridal Jewellery", "Corporate Gifting", "Solitaire Jewellery", "Kitty Scheme", "Sizing Guides", "Festival Guides"];
const BLOCK_TYPES = [
  { k: "h2", l: "Heading (H2)" },
  { k: "h3", l: "FAQ Question (H3)" },
  { k: "p", l: "Paragraph" },
  { k: "ul", l: "Bullet List" },
  { k: "quote", l: "Quote" },
];

function emptyBlock(type) {
  if (type === "ul") return { ul: [""] };
  return { [type]: "" };
}

function blockType(b) {
  return BLOCK_TYPES.find((t) => t.k in b)?.k || "p";
}

const emptyPost = () => ({
  id: null,
  slug: "",
  category: CATEGORIES[0],
  title: "",
  description: "",
  heroImage: "",
  heroImageAlt: "",
  ctaHeading: "",
  ctaText: "",
  ctaHref: "",
  ctaLabel: "",
  publishedAt: new Date().toISOString().slice(0, 10),
  body: [{ p: "" }],
});

export default function BlogAdminScreen({ crmSecret }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null = list view, object = editor

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/blog?action=admin-list", { headers: { "x-crm-secret": crmSecret } });
      const d = await res.json();
      setPosts(d.ok ? d.posts : []);
    } catch { setPosts([]); }
    setLoading(false);
  }, [crmSecret]);

  useEffect(() => { load(); }, [load]);

  if (editing) {
    return (
      <PostEditor
        post={editing}
        crmSecret={crmSecret}
        onDone={() => { setEditing(null); load(); }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  const now = Date.now();

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h2 style={{ margin: 0 }}>Blog Admin</h2>
        <button onClick={() => setEditing(emptyPost())} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#111", color: "#fff", fontSize: 13, cursor: "pointer" }}>
          + New Article
        </button>
      </div>

      {loading ? (
        <div style={{ color: "#888", fontSize: 13 }}>Loading…</div>
      ) : posts.length === 0 ? (
        <div style={{ color: "#888", fontSize: 13 }}>No articles yet.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: "6px 8px" }}>Title</th>
              <th style={{ padding: "6px 8px" }}>Category</th>
              <th style={{ padding: "6px 8px" }}>Status</th>
              <th style={{ padding: "6px 8px" }}>Published</th>
              <th style={{ padding: "6px 8px" }}></th>
            </tr>
          </thead>
          <tbody>
            {posts.map((p) => {
              const isFuture = new Date(p.publishedAt).getTime() > now;
              return (
                <tr key={p.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "6px 8px" }}>{p.title}</td>
                  <td style={{ padding: "6px 8px" }}>{p.category}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 11, background: isFuture ? "#FEF3C7" : "#DCFCE7", color: isFuture ? "#92400E" : "#166534" }}>
                      {isFuture ? "Scheduled" : "Live"}
                    </span>
                  </td>
                  <td style={{ padding: "6px 8px" }}>{new Date(p.publishedAt).toLocaleDateString()}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>
                    <button onClick={() => setEditing(p)} style={{ padding: "5px 12px", borderRadius: 5, border: "1px solid #ddd", background: "#fff", cursor: "pointer", fontSize: 12 }}>Edit</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PostEditor({ post, crmSecret, onDone, onCancel }) {
  const [form, setForm] = useState({ ...post, publishedAt: post.publishedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10) });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState("");

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const setBlock = (i, next) => setForm((f) => ({ ...f, body: f.body.map((b, idx) => (idx === i ? next : b)) }));
  const addBlock = () => setForm((f) => ({ ...f, body: [...f.body, emptyBlock("p")] }));
  const removeBlock = (i) => setForm((f) => ({ ...f, body: f.body.filter((_, idx) => idx !== i) }));
  const moveBlock = (i, dir) => setForm((f) => {
    const next = [...f.body];
    const j = i + dir;
    if (j < 0 || j >= next.length) return f;
    [next[i], next[j]] = [next[j], next[i]];
    return { ...f, body: next };
  });

  const save = async () => {
    setErr("");
    if (!form.slug.trim() || !form.title.trim() || !form.description.trim()) {
      setErr("Slug, title, and description are required.");
      return;
    }
    setSaving(true);
    try {
      const action = form.id ? "update" : "create";
      const res = await fetch(`/api/blog?action=${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-crm-secret": crmSecret },
        body: JSON.stringify({ ...form, publishedAt: new Date(form.publishedAt).toISOString() }),
      });
      const d = await res.json();
      if (!d.ok) { setErr(d.error || "Save failed."); setSaving(false); return; }
      onDone();
    } catch {
      setErr("Network error — please try again.");
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!form.id) return onCancel();
    if (!window.confirm(`Delete "${form.title}"? This can't be undone.`)) return;
    setDeleting(true);
    try {
      await fetch("/api/blog?action=delete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-crm-secret": crmSecret },
        body: JSON.stringify({ id: form.id }),
      });
      onDone();
    } catch {
      setErr("Delete failed — please try again.");
      setDeleting(false);
    }
  };

  const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 5, border: "1px solid #ddd", fontSize: 13, marginBottom: 12, boxSizing: "border-box" };
  const labelStyle = { fontSize: 11.5, color: "#666", marginBottom: 4, display: "block", fontWeight: 600 };

  return (
    <div style={{ padding: 20, maxWidth: 800 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h2 style={{ margin: 0 }}>{form.id ? "Edit Article" : "New Article"}</h2>
        <button onClick={onCancel} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", cursor: "pointer", fontSize: 12.5 }}>Back to list</button>
      </div>

      <label style={labelStyle}>Title *</label>
      <input style={inputStyle} value={form.title} onChange={(e) => set("title", e.target.value)} />

      <label style={labelStyle}>Slug * (URL path — lowercase, hyphens, no spaces; changing this breaks the old link)</label>
      <input style={inputStyle} value={form.slug} onChange={(e) => set("slug", e.target.value.trim())} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>Category</label>
          <select style={inputStyle} value={form.category} onChange={(e) => set("category", e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Publish Date (future = scheduled, not yet public)</label>
          <input type="date" style={inputStyle} value={form.publishedAt} onChange={(e) => set("publishedAt", e.target.value)} />
        </div>
      </div>

      <label style={labelStyle}>Description (meta description + card summary) *</label>
      <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.description} onChange={(e) => set("description", e.target.value)} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>Hero Image URL (e.g. /images/blog/my-image.jpg)</label>
          <input style={inputStyle} value={form.heroImage} onChange={(e) => set("heroImage", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Hero Image Alt Text</label>
          <input style={inputStyle} value={form.heroImageAlt} onChange={(e) => set("heroImageAlt", e.target.value)} />
        </div>
      </div>

      <div style={{ padding: 14, background: "#F8F8F8", borderRadius: 6, marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: "#444" }}>Call-to-Action</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>CTA Heading</label>
            <input style={inputStyle} value={form.ctaHeading} onChange={(e) => set("ctaHeading", e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>CTA Button Label</label>
            <input style={inputStyle} value={form.ctaLabel} onChange={(e) => set("ctaLabel", e.target.value)} />
          </div>
        </div>
        <label style={labelStyle}>CTA Text</label>
        <input style={inputStyle} value={form.ctaText} onChange={(e) => set("ctaText", e.target.value)} />
        <label style={labelStyle}>CTA Link (e.g. /solitaire-jewellery)</label>
        <input style={inputStyle} value={form.ctaHref} onChange={(e) => set("ctaHref", e.target.value)} />
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Article Body</div>
      <div style={{ fontSize: 11.5, color: "#888", marginBottom: 12 }}>
        Use FAQ Question (H3) only for genuine Q&amp;A pairs — each H3 immediately followed by a Paragraph auto-generates FAQ rich-result markup. Use Heading (H2) for regular subheadings.
      </div>
      {form.body.map((block, i) => (
        <BlockEditor
          key={i}
          block={block}
          onChange={(next) => setBlock(i, next)}
          onRemove={() => removeBlock(i)}
          onMoveUp={() => moveBlock(i, -1)}
          onMoveDown={() => moveBlock(i, 1)}
          isFirst={i === 0}
          isLast={i === form.body.length - 1}
        />
      ))}
      <button onClick={addBlock} style={{ padding: "8px 16px", borderRadius: 6, border: "1px dashed #999", background: "#fff", cursor: "pointer", fontSize: 12.5, marginBottom: 20 }}>
        + Add Block
      </button>

      {err && <div style={{ color: "#B91C1C", fontSize: 12.5, marginBottom: 12 }}>{err}</div>}

      <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #eee", paddingTop: 16 }}>
        <button onClick={remove} disabled={deleting} style={{ padding: "9px 18px", borderRadius: 6, border: "1px solid #B91C1C", background: "#fff", color: "#B91C1C", cursor: "pointer", fontSize: 13 }}>
          {form.id ? (deleting ? "Deleting…" : "Delete Article") : "Cancel"}
        </button>
        <button onClick={save} disabled={saving} style={{ padding: "9px 22px", borderRadius: 6, border: "none", background: "#111", color: "#fff", cursor: "pointer", fontSize: 13 }}>
          {saving ? "Saving…" : "Save Article"}
        </button>
      </div>
    </div>
  );
}

function BlockEditor({ block, onChange, onRemove, onMoveUp, onMoveDown, isFirst, isLast }) {
  const type = blockType(block);

  const changeType = (newType) => onChange(emptyBlock(newType));

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 12, marginBottom: 10, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <select value={type} onChange={(e) => changeType(e.target.value)} style={{ fontSize: 11.5, padding: "3px 6px", borderRadius: 4, border: "1px solid #ddd" }}>
          {BLOCK_TYPES.map((t) => <option key={t.k} value={t.k}>{t.l}</option>)}
        </select>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={onMoveUp} disabled={isFirst} style={{ fontSize: 11, padding: "2px 8px", cursor: isFirst ? "default" : "pointer", border: "1px solid #ddd", borderRadius: 4, background: "#fff", opacity: isFirst ? 0.4 : 1 }}>↑</button>
          <button onClick={onMoveDown} disabled={isLast} style={{ fontSize: 11, padding: "2px 8px", cursor: isLast ? "default" : "pointer", border: "1px solid #ddd", borderRadius: 4, background: "#fff", opacity: isLast ? 0.4 : 1 }}>↓</button>
          <button onClick={onRemove} style={{ fontSize: 11, padding: "2px 8px", cursor: "pointer", border: "1px solid #B91C1C", borderRadius: 4, background: "#fff", color: "#B91C1C" }}>Remove</button>
        </div>
      </div>

      {type === "ul" ? (
        <textarea
          style={{ width: "100%", minHeight: 70, padding: 8, borderRadius: 4, border: "1px solid #ddd", fontSize: 12.5, boxSizing: "border-box" }}
          placeholder="One list item per line"
          value={(block.ul || []).join("\n")}
          onChange={(e) => onChange({ ul: e.target.value.split("\n") })}
        />
      ) : (
        <textarea
          style={{ width: "100%", minHeight: type === "p" || type === "quote" ? 70 : 36, padding: 8, borderRadius: 4, border: "1px solid #ddd", fontSize: 12.5, boxSizing: "border-box" }}
          value={block[type] || ""}
          onChange={(e) => onChange({ [type]: e.target.value })}
        />
      )}
    </div>
  );
}
