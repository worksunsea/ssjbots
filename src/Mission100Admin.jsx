// Mission 100 admin tab — create/manage race groups, view per-group
// leaderboards, manually assign walk-in members, declare/correct
// checkpoint winners, and track trip-prize fulfillment. Own file (not
// crammed into KittyAdmin.jsx) since Mission 100's data model (groups +
// checkpoint wins) is materially different from the flat member lists the
// other kitty schemes use.

import { useState, useEffect, useCallback } from "react";

const API = "/api/kitty";

async function call(action, { method = "GET", body, crmSecret, params } = {}) {
  const qs = new URLSearchParams({ action, ...(params || {}) }).toString();
  const res = await fetch(`${API}?${qs}`, {
    method, cache: "no-store",
    headers: { "Content-Type": "application/json", "x-crm-secret": crmSecret },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

function gramsFor(installments, possessionFilter) {
  const settled = (installments || []).filter((i) => (i.status === "paid" || i.status === "free") && (!possessionFilter || (i.possession || "with_company") === possessionFilter));
  return settled.reduce((sum, i) => (i.rate_locked ? sum + Number(i.paid_amount ?? i.amount ?? 0) / Number(i.rate_locked) : sum), 0);
}

const STATUS_COLORS = { forming: "#fef3c7", racing: "#dbeafe", completed: "#d1fae5", closed: "#e5e7eb" };
const PRIZE_STATUSES = ["not_applicable", "pending", "booked", "fulfilled"];

export default function Mission100Admin({ crmSecret, actor }) {
  const [groups, setGroups] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ label: "", size: 20 });
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    const d = await call("mission100-list-groups", { crmSecret, params: statusFilter ? { status: statusFilter } : {} });
    setGroups(d.ok ? d.groups : []);
  }, [crmSecret, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const createGroup = async () => {
    if (!form.label.trim()) { alert("Group label required"); return; }
    setCreating(true);
    const d = await call("mission100-create-group", { method: "POST", crmSecret, body: { label: form.label.trim(), size: Number(form.size), formedBy: "staff", createdBy: actor, actor } });
    setCreating(false);
    if (d.ok) { setForm({ label: "", size: 20 }); load(); } else alert(d.error);
  };

  const startGroup = async (groupId) => {
    const d = await call("mission100-start-group", { method: "POST", crmSecret, body: { groupId, actor } });
    if (d.ok) load(); else alert(d.error);
  };

  const setPrizeStatus = async (groupId, prizeStatus) => {
    const d = await call("mission100-set-prize-status", { method: "POST", crmSecret, body: { groupId, prizeStatus, actor } });
    if (d.ok) load(); else alert(d.error);
  };

  const declareWinner = async (groupId, member) => {
    const checkpointGrams = prompt("Checkpoint to declare (25, 50, 75, or 100)?", "100");
    if (!checkpointGrams) return;
    const d = await call("mission100-declare-winner", { method: "POST", crmSecret, body: { groupId, enrollmentId: member.enrollment.id, checkpointGrams: Number(checkpointGrams), recordedBy: actor, actor } });
    if (d.ok) load(); else alert(d.error);
  };

  const awardBonus = async (member) => {
    const reason = prompt("Reason for bonus coin (checkpoint / referral / completion)?", "completion");
    if (!reason) return;
    const d = await call("mission100-award-bonus", { method: "POST", crmSecret, body: { enrollmentId: member.enrollment.id, reason, recordedBy: actor, actor } });
    if (d.ok) { alert("+1g bonus coin awarded"); load(); } else alert(d.error);
  };

  if (groups === null) return <div style={{ padding: 20 }}>Loading…</div>;

  return (
    <div style={{ padding: 20 }}>
      <h3>Mission 100 — Race Groups</h3>
      <p style={{ color: "#666", fontSize: 13, maxWidth: 700 }}>
        Each group races to 100g. First to 25g/50g/75g wins a +1g bonus; first to 100g wins the couple's trip.
        Everyone who reaches 100g gets a +1g completion bonus, regardless of rank. Referrers earn +1g per 5
        referred members who've each hit 25g. All auto-detected daily by cron — use the controls below only to
        correct or hand-declare early.
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "16px 0" }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="forming">Forming</option>
          <option value="racing">Racing</option>
          <option value="completed">Completed</option>
          <option value="closed">Closed</option>
        </select>
        <input placeholder="New group label" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} style={{ width: 220 }} />
        <select value={form.size} onChange={(e) => setForm((f) => ({ ...f, size: e.target.value }))}>
          <option value={10}>10 members — domestic-tier group</option>
          <option value={20}>20 members</option>
        </select>
        <button onClick={createGroup} disabled={creating}>{creating ? "Creating…" : "+ Create Group"}</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {groups.map((g) => {
          const isOpen = expanded === g.id;
          const winCheckpoints = new Map((g.checkpointWins || []).map((w) => [w.checkpoint_grams, w]));
          return (
            <div key={g.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <b>{g.group_label}</b>{" "}
                  <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, background: STATUS_COLORS[g.status] || "#eee" }}>{g.status}</span>{" "}
                  <span style={{ fontSize: 12, color: "#666" }}>{g.members.length}/{g.size} members · invite code <code>{g.invite_code}</code></span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {g.status === "forming" && <button onClick={() => startGroup(g.id)}>Force Start</button>}
                  <button onClick={() => setExpanded(isOpen ? null : g.id)}>{isOpen ? "Collapse" : "Leaderboard"}</button>
                </div>
              </div>

              <div style={{ marginTop: 6, fontSize: 12 }}>
                {[25, 50, 75, 100].map((cp) => {
                  const win = winCheckpoints.get(cp);
                  const winner = win ? g.members.find((m) => m.id === win.winner_member_id) : null;
                  return (
                    <span key={cp} style={{ marginRight: 12 }}>
                      {cp}g: {winner ? `🏆 ${winner.enrollment?.lead?.name || "—"}` : "— unclaimed"}
                    </span>
                  );
                })}
              </div>

              {g.status === "completed" && (
                <div style={{ marginTop: 8, fontSize: 12.5 }}>
                  Prize status:{" "}
                  <select value={g.prize_status} onChange={(e) => setPrizeStatus(g.id, e.target.value)}>
                    {PRIZE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}

              {isOpen && (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 10 }}>
                  <thead><tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                    <th>Rank</th><th>Name</th><th>Phone</th><th>Grams</th><th>Progress</th><th>Finished</th><th></th>
                  </tr></thead>
                  <tbody>
                    {g.members.map((m, idx) => {
                      const total = m.totalGrams ?? gramsFor(m.enrollment?.installments);
                      return (
                        <tr key={m.id} style={{ borderBottom: "1px solid #eee" }}>
                          <td>#{idx + 1}</td>
                          <td>{m.enrollment?.lead?.name || "—"}</td>
                          <td>{m.enrollment?.lead?.phone || "—"}</td>
                          <td>{total.toFixed(3)}g</td>
                          <td style={{ width: 140 }}>
                            <div style={{ background: "#eee", borderRadius: 4, height: 8, overflow: "hidden" }}>
                              <div style={{ width: `${Math.min(100, (total / 100) * 100)}%`, background: "#d4af37", height: "100%" }} />
                            </div>
                          </td>
                          <td>{m.finished_at ? "✅" : "—"}</td>
                          <td>
                            <button onClick={() => awardBonus(m)} style={{ marginRight: 4 }}>+1g bonus</button>
                            <button onClick={() => declareWinner(g.id, m)}>Declare checkpoint</button>
                          </td>
                        </tr>
                      );
                    })}
                    {!g.members.length && <tr><td colSpan={7}>No members yet.</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
        {!groups.length && <div>No Mission 100 groups yet.</div>}
      </div>
    </div>
  );
}
