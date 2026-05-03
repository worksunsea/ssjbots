// One-time migration: Gullak FAQs + training doc + gamified MCQ quizzes
// Run: node scripts/run-gullak-migrations.mjs

import { createClient } from "@supabase/supabase-js";

const SUPA_URL = "https://uppyxzellmuissdlxsmy.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwcHl4emVsbG11aXNzZGx4c215Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyODczNTMsImV4cCI6MjA5MTg2MzM1M30._eFep-C0IYuT-73AQU9oqE2k1bqneWZjsydUZGwt24E";
const TENANT = "a1b2c3d4-0000-0000-0000-000000000001";
const sb = createClient(SUPA_URL, ANON, { auth: { persistSession: false } });

// ── Clean up probe row ────────────────────────────────────────────────────────
await sb.from("bullion_faqs").delete().eq("keywords", "test_migration_probe");

// ── 1. FAQs ──────────────────────────────────────────────────────────────────
const faqs = [
  { keywords: "gullak scheme, what is gullak, gullak kya hai, monthly gold scheme, gold savings scheme, scheme kya hai, gold plan", answer: "Gold Gullak Scheme is our monthly gold coin savings plan — you buy 1gm MMTC Gold Coin every month for 2 years. Completely flexible: pause, stop, or resume any time. Just basic KYC and documentation to join.", sort_order: 100 },
  { keywords: "why sun sea, why choose sun sea, trusted brand, which company, reliable, why buy from you, authorised dealer, mmtc authorised", answer: "Sun Sea Jewellers is a trusted brand with 46+ years of experience — established in 1984. We are an MMTC Authorised Dealer with 35+ experts. Originally in Maliwara, Chandni Chowk (1984–2005), Karol Bagh since 2005 with a brand new showroom since 2023. 150+ Gullak members already enrolled.", sort_order: 110 },
  { keywords: "terms conditions, kyc, documents needed, how to join, sign up, enroll, join kaise kare, procedure", answer: "Very simple — just normal KYC and basic documentation required. 2-year scheme: buy 1gm gold coin every month. Fully flexible — stop, pause, or resume any time.", sort_order: 120 },
  { keywords: "stop scheme, pause, cancel, exit, flexible, can i stop, band karna, rok sakte, lock in, beech mein rokna", answer: "Yes — fully flexible. Stop or pause any time and resume whenever you want. No penalty, no lock-in.", sort_order: 130 },
  { keywords: "gold coin type, purity, mmtc, 999, 9999, coin brand, coin quality, hallmark, which coin, pure gold, pamp, swiss pamp, pamp suisse", answer: "We offer MMTC 999.9 Pure Gold Coins — in partnership with Swiss PAMP Suisse (world's best gold refinery). Purity comparison: MMTC = 999.9 | Tanoy/Malabar = 999 | Local retailers = 995. Our MMTC coins are the purest.", sort_order: 140 },
  { keywords: "door step delivery, home delivery, doorstep, delivery available, ghar pe milega, delivery delhi ncr, deliver karte ho", answer: "Yes! Doorstep delivery in Delhi NCR. Free if near a Metro station or within 15km from our Karol Bagh store.", sort_order: 150 },
  { keywords: "sell back, buyback, sell gold coin, can i sell, bechna chahta, gold bechna, resale", answer: "Yes — sell your gold coins back to us or anywhere at current market rate, any time.", sort_order: 160 },
  { keywords: "delivery charges, delivery cost, kitna charge, charge lagega, shipping", answer: "Free delivery — mostly if near a Metro station or within 15km of our Karol Bagh store.", sort_order: 170 },
  { keywords: "gold rate today, current rate, aaj ka bhav, price today, gold price, sone ka bhav, live rate", answer: "Message us \"Today's Gold Rate\" here or call 8860866000 — we'll share the live rate right away.", sort_order: 180 },
  { keywords: "gold etf, etf vs gullak, difference, paper gold, physical vs etf, digital gold", answer: "Our Gullak = physical gold in your hands. ETF is paper trading — you don't hold actual gold. ETF also has buy/sell price variation causing losses over time.", sort_order: 190 },
  { keywords: "more than 1gm, 2gm, 5gm, bigger coin, multiple grams, 10gm, how much can i buy, zyada kharid sakte, denomination", answer: "Yes! In the Gullak Scheme: 1gm, 2gm, 5gm, 8gm or 10gm monthly. For 20gm, 50gm, 100gm — available any time outside the scheme.", sort_order: 200 },
  { keywords: "budget, 5000, less money, small amount, cannot afford, low budget, kitna minimum, 500 month, 100 day, sip gold, daily invest", answer: "No problem! We have a separate monthly Gold & Silver SIP Scheme starting as low as ₹500/month or ₹100/day. Download the Sun Sea Jewellers app on Play Store or App Store.", sort_order: 210 },
  { keywords: "what is gullak box, gullak box, metal box, what comes in gullak, gullak mein kya hota, box kya hai", answer: "Gullak is a special metal box for your Gold Coins. Comes with: Pyrite crystal stone + scheme document. Personalised with your name, phone, and serial number.", sort_order: 220 },
  { keywords: "my gullak, identify, name on gullak, serial number, how to identify, personalised", answer: "Your name, phone number, and a unique serial number are printed on your Gullak.", sort_order: 230 },
  { keywords: "pyrite stone, pyrite, crystal, stone in gullak, pyrite kya hai, pathar kya hai, prosperity", answer: "Pyrite is a crystal that multiplies wealth and money when kept in a secure place — included in every Gullak as a prosperity symbol.", sort_order: 240 },
  { keywords: "how many enrolled, how many members, kitne log, already joined, popular, kitne members hain", answer: "In the last month alone 150+ members enrolled in the Gullak Scheme. Spots are filling up fast!", sort_order: 250 },
  { keywords: "total members, maximum, capacity, how many total, limited seats, max members", answer: "Maximum 500 members only — strictly first come, first served.", sort_order: 260 },
  { keywords: "till when enroll, deadline, last date, when can i join, enroll kab tak, registration open", answer: "You can enroll any time until all 500 spots are filled. Don't wait — spots are going fast!", sort_order: 270 },
  { keywords: "already investing gold, why gullak, benefit, personal savings, secret savings, pehle se gold hai", answer: "This is your personal secret saving — in your own custody. Cash it out any time. No one in the family needs to know.", sort_order: 280 },
  { keywords: "bank vs gold, fd vs gold, better than fd, savings account, returns, interest, why not bank, why not fd, fixed deposit", answer: "Bank: 2.5–6% returns. FD: max 7.5% with 5-year lock-in + capital gains tax (eats 10%+ more). Gold Gullak: 15–20% average returns, and 4x in last 2 years. Sell any time — need ₹25,000? Sell just 2gm, rest stays intact. You cannot break an FD in half.", sort_order: 290 },
  { keywords: "gold coin price, 1gm price, aaj ka rate, price 1 gram, coin kitne ka hai, rate batao", answer: "Gold price changes daily. Message us \"Today's Gold Rate\" or call 8860866000.", sort_order: 300 },
  { keywords: "making charges, labour charges, coin charges, extra charges, hidden charges, additional fees", answer: "No hidden making charges. Price is MMTC official rate — discounted vs MMTC website and local stores.", sort_order: 310 },
  { keywords: "payment, upi, cash, neft, bank transfer, how to pay, online payment, paytm, gpay, phonepe", answer: "Cash or online — both available. UPI, NEFT, bank transfer all accepted. Bill/receipt mandatory every time.", sort_order: 320 },
  { keywords: "jewellery, why buy jewellery, jewellery collection, jewellery variety, design, best jeweller, gold jewellery", answer: "Top trending designs, excellent craftsmanship, huge variety in Gold, Silver & Diamond Jewellery. Sourced from export houses in Mumbai, Surat, Kolkata, Rajasthan. Imported from Italy, Dubai & Turkey.", sort_order: 330 },
  { keywords: "custom design, custom jewellery, own design, apna design, design bana do, banwa sakte", answer: "Yes! In-house team of jewellery designers with 35+ years experience. Share any design and we'll make it.", sort_order: 340 },
  { keywords: "brand copy, copy design, copy jewellery, duplicate, brand ka copy, copy kar sakte, replica", answer: "We can recreate designs but don't make brand copies. We have exclusive designer pieces — visit the showroom.", sort_order: 350 },
  { keywords: "sun sea app, app, download, mobile app, play store, app store, sip app, daily gold, app kaha milega", answer: "Download the Sun Sea Jewellers app — search \"Sun Sea Jewellers\" on Google Play Store or Apple App Store. Start Gold & Silver SIP from ₹100/day.", sort_order: 360 },
];

console.log(`Inserting ${faqs.length} FAQs...`);
const { error: faqErr } = await sb.from("bullion_faqs").insert(faqs.map(f => ({ ...f, tenant_id: TENANT, active: true })));
if (faqErr) { console.error("FAQ error:", faqErr.message); process.exit(1); }
console.log("✓ FAQs done");

// ── 2. Training document ─────────────────────────────────────────────────────
const trainingDoc = `GOLD GULLAK SCHEME — STAFF TRAINING GUIDE
==========================================

ABOUT SUN SEA JEWELLERS
------------------------
• Established 1984 — 46+ years of trust
• 1984–2005: Maliwara, Chandni Chowk
• 2005–now: Karol Bagh (new showroom since 2023)
• MMTC Authorised Dealer
• Team of 35+ experts
• 150+ Gullak Scheme members enrolled so far

WHAT IS THE GOLD GULLAK SCHEME?
---------------------------------
Monthly gold coin savings plan:
• Buy 1gm MMTC Gold Coin every month
• 2-year scheme (fully flexible — pause/stop/resume any time)
• Join with basic KYC + documentation
• Each member gets a personalised Gullak box

THE GULLAK BOX
--------------
• Special metal box for storing Gold Coins
• Contains: Pyrite crystal stone + scheme document
• Personalised: member name, phone, serial number on box
• Pyrite = prosperity crystal (multiplies wealth when kept securely)
• Max 500 members total — first come, first served

GOLD COIN DETAILS
-----------------
• MMTC 999.9 Pure Gold Coin (in partnership with Swiss PAMP Suisse — world's best gold refinery)
• Purity comparison:
    MMTC (ours):         999.9  ✓ best
    Tanoy/Malabar brand: 999
    Local retailers:     995
• Sizes in scheme (monthly): 1gm, 2gm, 5gm, 8gm, 10gm
• Bigger sizes (20gm, 50gm, 100gm): available any time outside scheme

SCHEME TERMS
------------
• Basic KYC + docs to join
• 2-year scheme — buy 1gm coin every month
• No lock-in: pause, stop, resume any time, no penalty
• Doorstep delivery: Delhi NCR, free if within 15km of Karol Bagh or near Metro
• Sell back to us OR anywhere at current market rate, any time

WHY BETTER THAN BANK / FD?
---------------------------
Bank:        2.5–6% returns only
FD:          max 7.5%, 5-year lock-in + capital gains tax (eats 10%+ of returns)
Gold Gullak: 15–20% average returns. Min 10% YoY historically. Last 2 years: 4x

KEY LINE: "If you need ₹25,000 — sell just 2gm of gold. The rest stays intact.
           You cannot break an FD in half."

WHY NOT GOLD ETF?
-----------------
• ETF = paper trading — no physical gold in hand
• ETF has buy/sell price variation = losses over time
• Our scheme = real physical gold. Real value.

PRICING & PAYMENTS
------------------
• Price changes daily — tell clients to ask "Today's Gold Rate"
• Our price = MMTC official rate, discounted vs website + local stores
• No hidden making charges on coins
• Accepted: Cash, UPI, NEFT, Bank Transfer
• Bill mandatory every transaction

GOLD SIP APP (separate scheme — for low-budget clients)
--------------------------------------------------------
For clients who say "I can't afford ₹5000/month":
• Monthly Gold & Silver SIP — starts at ₹500/month or ₹100/day
• App: search "Sun Sea Jewellers" on Google Play or Apple App Store
• Pitch: "Don't miss this golden opportunity — start small, grow big."

JEWELLERY
---------
• Top trending designs, great craftsmanship, reasonable making charges
• Gold, Silver & Diamond — huge variety
• Sourced from export houses: Mumbai, Surat, Kolkata, Rajasthan
• Imported: Italy, Dubai, Turkey
• Local karigar: urgent repairs only
• In-house designers: 35+ years experience
• Custom designs: YES   |   Brand copies: NO (own exclusive pieces available)

CONTACT: 8860866000`;

// ── 3. MCQ Quizzes ──────────────────────────────────────────────────────────
// Format: [{q, opts:[A,B,C,D], ans: 0-3}]

const companyQuiz = [
  { q: "When was Sun Sea Jewellers established?", opts: ["1990", "1984", "2005", "1975"], ans: 1 },
  { q: "Where was the original SSJ showroom located?", opts: ["Karol Bagh", "Connaught Place", "Maliwara, Chandni Chowk", "Lajpat Nagar"], ans: 2 },
  { q: "When did SSJ move to Karol Bagh?", opts: ["1984", "2000", "2005", "2010"], ans: 2 },
  { q: "When did the new Karol Bagh showroom open?", opts: ["2020", "2021", "2022", "2023"], ans: 3 },
  { q: "How many experts are on the SSJ team?", opts: ["10+", "20+", "35+", "50+"], ans: 2 },
  { q: "SSJ is an authorised dealer of which government body?", opts: ["RBI", "MMTC", "BIS", "SEBI"], ans: 1 },
  { q: "SSJ MMTC coins are certified in partnership with which refinery?", opts: ["Perth Mint", "Swiss PAMP Suisse", "Valcambi", "Argor-Heraeus"], ans: 1 },
  { q: "How many years has SSJ been in Karol Bagh (as of 2026)?", opts: ["10 years", "15 years", "21 years", "30 years"], ans: 2 },
];

const gullakQuiz = [
  { q: "What is the purity of the MMTC Gold Coins SSJ sells?", opts: ["916", "995", "999", "999.9"], ans: 3 },
  { q: "What is the purity of coins sold by local retailers?", opts: ["999.9", "999", "995", "916"], ans: 2 },
  { q: "How long is the Gold Gullak Scheme?", opts: ["1 year", "2 years", "3 years", "5 years"], ans: 1 },
  { q: "Can a customer pause the Gullak Scheme?", opts: ["No, it is locked in", "Yes but with penalty", "Yes, fully flexible, no penalty", "Only after 6 months"], ans: 2 },
  { q: "What is the maximum number of members in the Gullak Scheme?", opts: ["200", "350", "500", "1000"], ans: 2 },
  { q: "What are the average returns from the Gullak Scheme?", opts: ["5–8%", "8–12%", "15–20%", "25–30%"], ans: 2 },
  { q: "What is the maximum return on an FD in India?", opts: ["3.5%", "5%", "7.5%", "10%"], ans: 2 },
  { q: "Is doorstep delivery available?", opts: ["No", "Yes, but paid", "Yes, free if within 15km or near Metro", "Only for 5gm+"], ans: 2 },
  { q: "A customer needs ₹25,000 urgently. What's the best answer?", opts: ["Break your FD", "Sell only 2gm gold — rest stays intact", "Apply for a loan", "Redeem the whole scheme"], ans: 1 },
  { q: "Gold ETF vs Gullak — key difference?", opts: ["ETF is cheaper", "ETF gives more returns", "Gullak is physical gold; ETF is paper trading", "ETF has no fees"], ans: 2 },
  { q: "Minimum amount to start with the Gold SIP App?", opts: ["₹5,000/month", "₹1,000/month", "₹500/month or ₹100/day", "₹10,000/month"], ans: 2 },
  { q: "What returns did gold give in the last 2 years?", opts: ["2x", "3x", "4x", "1.5x"], ans: 2 },
  { q: "What payment methods does SSJ accept?", opts: ["Cash only", "Online only", "Cash and online both", "Only bank transfer"], ans: 2 },
  { q: "Are there making charges on Gold Coins?", opts: ["Yes, 2%", "Yes, 5%", "No hidden charges", "Depends on quantity"], ans: 2 },
  { q: "What two items come inside the Gullak box?", opts: ["Gold coin + certificate", "Pyrite stone + scheme document", "Key + receipt", "Coin + insurance paper"], ans: 1 },
  { q: "What is Pyrite in the Gullak?", opts: ["A cheap plastic stone", "A crystal that multiplies wealth when kept securely", "A decorative item only", "A tracking chip"], ans: 1 },
  { q: "A customer already has gold investments. Why should they still take a Gullak?", opts: ["More gold is always better", "It is a personal secret saving in their own custody", "It earns interest", "It is tax-free"], ans: 1 },
  { q: "Which coin sizes can be bought monthly under the Gullak Scheme?", opts: ["Only 1gm", "1gm, 2gm, 5gm, 8gm, 10gm", "5gm and 10gm only", "Any size"], ans: 1 },
];

const resources = [
  {
    section: "Product Training",
    title: "Gold Gullak Scheme — Complete Staff Guide",
    type: "text",
    content: trainingDoc,
    visible_to: ["all"],
    sort_order: 10,
    created_by: "System",
  },
  {
    section: "Product Training",
    title: "Chapter 1 Quiz — SSJ Company & History",
    type: "quiz",
    content: JSON.stringify(companyQuiz),
    visible_to: ["all"],
    sort_order: 20,
    created_by: "System",
  },
  {
    section: "Product Training",
    title: "Chapter 2 Quiz — Gold Gullak Scheme",
    type: "quiz",
    content: JSON.stringify(gullakQuiz),
    visible_to: ["all"],
    sort_order: 30,
    created_by: "System",
  },
];

console.log("Inserting training resources...");
const { error: resErr } = await sb.from("resources").insert(
  resources.map(r => ({ ...r, tenant_id: TENANT, created_at: new Date().toISOString() }))
);
if (resErr) { console.error("Resources error:", resErr.message); process.exit(1); }
console.log("✓ Training doc + 2 quizzes inserted");
console.log("\n✅ Migration complete. Delete this script: rm scripts/run-gullak-migrations.mjs");
