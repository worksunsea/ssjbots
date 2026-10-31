// Paste into the Chrome javascript tool on any https://www.mmtcpamp.com page.
// Loads the gold list, silver list and Lotus gold bar page in hidden same-origin
// iframes, clicks every weight chip, collects {title: {price, soldOut}} and
// POSTs it to ssjbots /api/mmtc-prices. Sets window.__mmtcResult when done
// (poll it; takes ~2-3 minutes). TOKEN is replaced by the scheduled task.
window.__mmtcResult = null;
(async () => {
  const TOKEN = "__TOKEN__";
  const API = "https://ssjbot.gemtre.in/api/mmtc-prices" + (window.__mmtcDry ? "?dry=1" : "");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const num = (s) => Number(String(s).replace(/[^\d.]/g, ""));
  const out = {};
  const open = async (path) => {
    const f = document.createElement("iframe");
    f.style.cssText = "position:fixed;left:-9999px;top:0;width:1400px;height:1000px";
    f.src = path; document.body.appendChild(f);
    for (let i = 0; i < 40; i++) { await sleep(500); if (f.contentDocument?.querySelector(".goldNameNew, h1")) break; }
    return f;
  };
  const scrapeList = async (path) => {
    const f = await open(path); const d = f.contentDocument, w = f.contentWindow;
    for (let i = 0; i < 8; i++) { w.scrollTo(0, d.body.scrollHeight); await sleep(900); }
    for (const n of [...d.querySelectorAll(".goldNameNew")]) {
      const c = n.closest(".goldItemsFields").parentElement;
      const read = () => {
        const name = c.querySelector(".goldNameNew")?.innerText.trim();
        const price = num(c.querySelector(".productDetailFulfilmentPrice")?.innerText);
        if (name && price > 0) out[name] = { price, soldOut: /SOLD OUT/i.test(c.innerText) };
      };
      read();
      const chips = [...c.querySelectorAll(".getGrams *")].filter((e) => e.children.length === 0 && /^\d+(\.\d+)? ?g$/.test(e.innerText.trim()));
      for (const ch of chips) { ch.click(); await sleep(700); read(); }
    }
    f.remove();
  };
  const scrapeLotusBar = async () => {
    const f = await open("/shop/gold/lotus-gold-bar-24k-1gm"); const d = f.contentDocument;
    for (const l of ["1 g", "2 g", "5 g", "10 g", "20 g", "31.1 g", "50 g", "100 g"]) {
      const el = [...d.querySelectorAll("body *")].filter((e) => e.children.length === 0 && e.innerText?.trim() === l).pop();
      if (!el) continue;
      el.click(); await sleep(1500);
      const m = f.contentDocument.body.innerText.match(/Purest ([^\n]*Lotus Gold Bar)\n₹([\d,.]+)/);
      if (m) out[m[1]] = { price: num(m[2]), soldOut: false };
    }
    f.remove();
  };
  try {
    await scrapeList("/shop/gold");
    await scrapeLotusBar();
    await scrapeList("/shop/silver");
    const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", "x-mmtc-token": TOKEN }, body: JSON.stringify({ prices: out }) });
    window.__mmtcResult = JSON.stringify({ status: r.status, scraped: Object.keys(out).length, body: await r.json() });
  } catch (e) {
    window.__mmtcResult = JSON.stringify({ error: String(e), scraped: Object.keys(out).length });
  }
})();
"started";
