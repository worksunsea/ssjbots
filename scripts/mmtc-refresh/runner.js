// MMTC price runner. mmtcpamp.com can't be iframed, so the scheduled task visits
// 3 pages in order and runs one step on each; results accumulate in
// sessionStorage (key mmtc_acc) across the navigations.
//
// Install once per run (on any mmtcpamp.com page): localStorage.mmtc_runner_src = <this file's text>
// Then on each page: (0, eval)(localStorage.mmtc_runner_src); mmtcStep("<step>")
//   step "list"  – on /shop/gold or /shop/silver: clicks every weight chip, collects prices
//   step "lotus" – on /shop/gold/lotus-gold-bar-24k-1gm: clicks each weight, collects bar prices
//   step "post"  – anywhere on mmtcpamp.com: POSTs the accumulated prices to ssjbots
// Every step sets window.__mmtcDone = a JSON string when finished (poll it).
// Placeholders __TOKEN__ / __DRY__ are filled in by the task before install.
window.mmtcStep = async function (step) {
  window.__mmtcDone = null;
  const TOKEN = "__TOKEN__";
  const API = "https://ssjbot.gemtre.in/api/mmtc-prices" + ("__DRY__" === "1" ? "?dry=1" : "");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const num = (s) => Number(String(s).replace(/[^\d.]/g, ""));
  const acc = JSON.parse(sessionStorage.getItem("mmtc_acc") || "{}");
  const save = () => sessionStorage.setItem("mmtc_acc", JSON.stringify(acc));
  try {
    if (step === "reset") {
      sessionStorage.removeItem("mmtc_acc");
      window.__mmtcDone = JSON.stringify({ step, ok: true });
    } else if (step === "list") {
      const start = location.pathname;
      for (let i = 0; i < 8; i++) { window.scrollTo(0, document.body.scrollHeight); await sleep(900); }
      for (const n of [...document.querySelectorAll(".goldNameNew")]) {
        if (location.pathname !== start) break;
        const c = n.closest(".goldItemsFields").parentElement;
        const read = () => {
          const name = c.querySelector(".goldNameNew")?.innerText.trim();
          const price = num(c.querySelector(".productDetailFulfilmentPrice")?.innerText);
          if (name && price > 0) acc[name] = { price, soldOut: /SOLD OUT/i.test(c.innerText) };
        };
        read();
        const chips = [...c.querySelectorAll(".getGrams *")].filter((e) => e.children.length === 0 && /^\d+(\.\d+)? ?g$/.test(e.innerText.trim()));
        for (const ch of chips) { ch.click(); await sleep(700); if (location.pathname !== start) break; read(); }
      }
      save();
      window.__mmtcDone = JSON.stringify({ step, total: Object.keys(acc).length });
    } else if (step === "lotus") {
      for (const l of ["1 g", "2 g", "5 g", "10 g", "20 g", "31.1 g", "50 g", "100 g"]) {
        const el = [...document.querySelectorAll("body *")].filter((e) => e.children.length === 0 && e.innerText?.trim() === l).pop();
        if (!el) continue;
        el.click(); await sleep(1500);
        const m = document.body.innerText.match(/Purest ([^\n]*Lotus Gold Bar)\n₹([\d,.]+)/);
        if (m) acc[m[1]] = { price: num(m[2]), soldOut: false };
      }
      save();
      window.__mmtcDone = JSON.stringify({ step, total: Object.keys(acc).length });
    } else if (step === "post") {
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", "x-mmtc-token": TOKEN }, body: JSON.stringify({ prices: acc }) });
      window.__mmtcDone = JSON.stringify({ step, status: r.status, scraped: Object.keys(acc).length, body: await r.json() });
    }
  } catch (e) {
    window.__mmtcDone = JSON.stringify({ step, error: String(e) });
  }
};
