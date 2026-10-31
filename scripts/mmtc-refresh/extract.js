// Runs INSIDE an mmtcpamp.com /shop/gold or /shop/silver page (via the Chrome
// javascript tool). Clicks every weight chip on every product card and returns
// [{name, price}] for every variant. Result is JSON text.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 8; i++) { window.scrollTo(0, document.body.scrollHeight); await sleep(1000); }
  const num = (s) => Number(String(s).replace(/[^\d.]/g, ""));
  const out = {};
  const cards = [...document.querySelectorAll(".goldNameNew")].map((n) => n.closest(".goldItemsFields").parentElement);
  for (const c of cards) {
    const read = () => {
      const name = c.querySelector(".goldNameNew")?.innerText.trim();
      const price = num(c.querySelector(".productDetailFulfilmentPrice")?.innerText);
      const soldOut = /SOLD OUT/i.test(c.innerText);
      if (name && price > 0) out[name] = { price, soldOut };
    };
    read();
    const more = [...c.querySelectorAll(".getGrams *")].find((e) => /^More$/i.test(e.innerText?.trim()));
    if (more) { more.click(); await sleep(500); }
    const chips = [...c.querySelectorAll(".getGrams *")].filter((e) => e.children.length === 0 && /^\d+(\.\d+)? ?g$/.test(e.innerText.trim()));
    for (const ch of chips) { ch.click(); await sleep(800); read(); }
  }
  return JSON.stringify(out);
})()
