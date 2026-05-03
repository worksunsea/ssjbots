import { useState, useEffect, useRef, useCallback } from "react";

const FONT_LINK = "https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap";

// ─── DATA ─────────────────────────────────────────────────────────────────────
const INITIAL_MODULES = [
  {
    id:"m1", title:"Gold Basics", emoji:"🏅", color:"#B8860B", level:"Foundation", duration:"4–5 hrs",
    content:`GOLD PURITY & KARAT SYSTEM

Gold in jewellery is never 100% pure — it is always mixed with other metals (alloys) to add hardness and colour. Purity is measured in Karats (kt) or Fineness (parts per 1000).

24kt = 999 fineness = 99.9% pure gold. Used for coins and bars only. Too soft for jewellery.

22kt = 916 fineness = 91.6% pure gold. Most plain gold jewellery in India — bangles, chains, necklaces. Most popular in Delhi.

18kt = 750 fineness = 75% pure gold. Used for diamond and studded jewellery. Harder, takes fine setting work.

14kt = 585 fineness = 58.5% pure gold. Less common in India. Used in export and fashion jewellery.

Gold colour depends on alloy metals: Yellow gold is classic with silver and copper. White gold is mixed with palladium or nickel and usually rhodium-plated. Rose gold has higher copper content giving a warm pinkish tone.

BIS HALLMARKING & HUID

BIS hallmarking is mandatory for all gold jewellery in India since July 2021. It is managed by Bureau of Indian Standards.

Every hallmarked piece has 3 marks: (1) BIS Logo — a triangle with BIS inside, (2) Purity Mark — 916 or 750 or 585, (3) HUID — a 6-character alphanumeric unique code like AB1234.

HUID stands for Hallmark Unique Identification. Every piece gets its own unique HUID. Customers can verify on BIS Care App or bis.gov.in.

PRICING & BILLING

Gold jewellery price = Gold weight in grams multiplied by Today's IBJA rate, plus Making charge, plus Wastage if any, plus GST at 3%.

Making charge varies by design complexity — intricate handmade pieces have higher making charge because the karigar takes more time.

Always check IBJA Delhi rate every morning. Never quote rate from memory to a customer.

SELLING PLAIN GOLD

5-step process: First, greet and discover occasion and budget. Second, show 3 options — low, mid, aspirational. Third, help customer try it on. Fourth, tell the story of the piece and karigar. Fifth, confirm and move to billing.

Important: Never say 22kt is impure — it is 91.6% pure gold, the highest practical purity for jewellery. Always check back screws on earring tops before handing to customer.`
  },
  {
    id:"m2", title:"Diamond Selling", emoji:"💎", color:"#1A5276", level:"Core", duration:"5–6 hrs",
    content:`THE 4Cs OF DIAMONDS

Cut is the most important factor affecting diamond beauty. Cut quality determines how light reflects — Excellent, Very Good, Good, Fair, Poor grades. A well-cut diamond looks bigger and more brilliant than a poorly cut one of the same carat weight.

Colour is graded D (colourless) to Z (yellow tint). D to F means colourless, G to J means near colourless and eye-clean, K to M means faint yellow visible. For Indian jewellery, G to H is the sweet spot — looks white, better value.

Clarity grades are FL (Flawless), IF, VVS1, VVS2, VS1, VS2, SI1, SI2, I1, I2, I3. VVS and VS are eye-clean with inclusions visible only under 10x magnification. SI1 is usually eye-clean also and offers good value.

Carat is the weight of the diamond. 1 carat equals 0.2 grams. Price increases exponentially with carat — a 1ct diamond costs much more than two 0.5ct diamonds of same quality.

GIA CERTIFICATION

GIA (Gemological Institute of America) is the world's most respected diamond grading lab. A GIA certificate confirms the 4Cs independently. Certified diamonds give customer confidence and make resale easier.

Non-certified diamonds are not fake — they just have not been through lab grading. Good for fashion jewellery and budget pieces.

LAB-GROWN VS NATURAL DIAMONDS

Lab-grown diamonds are chemically identical to natural diamonds. They are significantly cheaper, typically 50 to 70 percent less. Natural diamonds have rarity value and emotional significance. Always disclose if a diamond is lab-grown — it is mandatory and builds trust.

SELLING DIAMONDS

Let the customer hold and look at the diamond under light. Use phrases like: Dekho kitni brilliance hai — yeh cut ki wajah se hai. For certified pieces, show the GIA certificate and explain what each grade means. Explain that the price reflects the 4Cs grading, not just weight.`
  },
  {
    id:"m3", title:"Polki & Kundan", emoji:"✨", color:"#7D3C98", level:"Advanced", duration:"3–4 hrs",
    content:`WHAT IS POLKI JEWELLERY

Polki uses uncut natural diamonds in their raw form, set on gold with foil called pardi as backing. The foil reflects light through the stone giving it a warm, antique glow. Polki diamonds are flat and matte-looking — unlike faceted cut diamonds which sparkle brightly.

Polki is associated with Mughal jewellery tradition and is especially popular for bridal jewellery in North India, particularly in Delhi, Rajasthan, and UP.

HOW POLKI DIFFERS FROM DIAMONDS

Polki diamonds are uncut and unpolished in their natural raw form. Regular diamonds are cut with precise facets for maximum brilliance. Polki has an organic, vintage look. Faceted diamonds have a bright sparkle. Polki is set in 23kt or 24kt gold which is very high purity soft gold ideal for setting. Faceted diamonds are usually set in 18kt gold.

KUNDAN SETTING TECHNIQUE

Kundan is the setting technique — fine gold foil called kundan is used to secure the stones. The jeweller uses a clay-like material called lac or lacquer inside the piece as support, then sets the stones with kundan. Kundan work is extremely labour-intensive — this is why making charges are very high on Polki Kundan pieces.

SELLING POLKI

Tell the heritage story: Yeh Mughal zamane ki jewellery-making technique hai. Delhi mein iska tradition bahut purana hai. Explain that foil backing is traditional and adds to the warmth of colour. Clarify to customers that Polki is natural diamonds — not glass or synthetic. Point out that Polki jewellery gets richer looking with time, unlike plated jewellery.`
  },
  {
    id:"m4", title:"Wedding Jewellery", emoji:"👑", color:"#1D6B5A", level:"Advanced", duration:"4–5 hrs",
    content:`BRIDAL JEWELLERY SETS

A complete bridal set typically includes: Necklace such as haar or choker, Maang tikka, Earrings such as jhumka or chandelier style, Bangles or kangan set, Nose ring called nath, Payal anklets, Haath phool hand jewellery, and Waist belt called kamarbandh for some traditions.

In Delhi and North India, 22kt gold with Polki or Kundan is very popular for bridal sets. South Indian bridal families typically prefer heavier 22kt plain gold sets.

CONSULTING BRIDAL FAMILIES

Always meet the bride AND the mother-in-law AND the mother — decisions are collective. Ask the occasion date first — this sets the urgency. Ask total budget upfront: Aap ka overall budget kya hai — gold jewellery ke liye? Show sets across 3 budget ranges. Never show only the most expensive option.

The bride personal style matters — modern brides often want lighter, more wearable pieces while traditional families want heavier showpiece jewellery.

WEDDING UPSELLING

Complement the main set with matching payal, small nose pin, and simple gold chain for daily wear after wedding. Offer Mangalsutra as a sentimental and meaningful piece. Suggest coordinating pieces for the husband — a gold chain or kada. Point out that wedding jewellery is an investment — HUID hallmarked pieces exchange at full gold rate.

HANDLING COMPETITION AND NEGOTIATION

Wedding is emotional — families want to feel they got the best deal. Never discount on the gold rate — it is market-fixed by IBJA. Making charge has some flexibility for large orders. Offer value-adds: free cleaning for 1 year, priority for future orders, complimentary gift packaging.`
  },
  {
    id:"m5", title:"Gemstones & Rudraksha", emoji:"🔮", color:"#117A65", level:"Core", duration:"3–4 hrs",
    content:`MAJOR GEMSTONES WE STOCK

Ruby called Manik is deep red and associated with the Sun. The most valued variety is Burmese pigeon blood ruby. Look for colour, clarity, and treatment — heat treatment is common and accepted. Popular for astrological rings.

Emerald called Panna is green and associated with Mercury. Colombian emeralds are most prized. Almost all natural emeralds have inclusions — look for rich green colour. Handle carefully as emeralds are brittle.

Blue Sapphire called Neelam is associated with Saturn. It is considered the most powerful and fast-acting gemstone in Vedic astrology — always advise customer to consult their astrologer before buying. Ceylon meaning Sri Lanka and Kashmir sapphires are most valued.

Yellow Sapphire called Pukhraj is associated with Jupiter. Light to golden yellow colour. Very popular for good luck, education, and marriage. Ceylon yellow sapphires are most trusted.

GEMSTONE QUALITY FACTORS

Colour is the most important factor — rich, vivid, even colour is best. Clarity means fewer inclusions equals higher value, with the exception being emeralds which always have natural inclusions. Cut maximises colour and lustre. Carat weight affects price exponentially with larger stones commanding much higher per-carat prices.

RUDRAKSHA

Rudraksha are seeds of the Elaeocarpus ganitrus tree, mostly sourced from Nepal and Indonesia. Faces called mukhi range from 1 to 21. 5-mukhi is most common and suitable for everyone. 1-mukhi is rarest and most expensive.

Check authenticity using the float test — real Rudraksha sinks in water. GEMTRE sources certified Rudraksha with authenticity certificate. Always explain the certification process to customers as it builds confidence.`
  },
  {
    id:"m6", title:"Customer Handling", emoji:"🤝", color:"#C0392B", level:"Operations", duration:"3–4 hrs",
    content:`THE GREETING

The first 30 seconds set the tone for the entire sale. Stand up when a customer enters. Smile and make eye contact. Offer water or chai within 2 minutes — this is a Delhi tradition and it works. Do not ask kya chahiye immediately — it feels transactional and off-putting. Instead say: Aayein, bataiye — kya dekh rahe hain aaj?

DISCOVERING NEEDS

Ask open questions: Kisi khaas occasion ke liye aa rahe hain? Bride ke liye hai ya family member ke liye? Budget rough idea bata dein — toh main wahi dikhata hun jo sahi ho. Never judge a customer by their appearance or clothing. The person in simple clothes can have the biggest budget. Always give equal attention to every customer.

SHOWING JEWELLERY

Never take out more than 3 to 4 pieces at a time — a cluttered counter confuses the customer and loses the sale. Always place pieces on a velvet tray — never on bare glass. For earrings always check back screws before handing to the customer. For necklaces offer to let them wear it and check in the mirror. Let the customer touch and feel — jewellery sells itself when it is held.

HANDLING DIFFICULT CUSTOMERS

When customer says Yahan sab mehenga hai respond: Aap sahi keh rahe hain, premium quality aur BIS hallmarking ke saath thoda difference hota hai. Lekin aap jo buy kar rahe hain uski value guaranteed hai.

When customer says Maine doosri jagah sasta dekha respond: Woh piece ka purity, weight, aur hallmark check karein. Same quality compare karein. Hum IBJA rate pe hi bill karte hain.

CLOSING AND AFTER-SALE

After completing the sale: Remind customer about HUID for their records. Tell them about free cleaning service. Give a business card and WhatsApp number. Ask for referrals warmly: Agar koi family mein ho jisko jewellery chahiye, zaroor bhejein. A warm referral request after a happy sale almost always works.`
  }
];

const INITIAL_LEADERBOARD = [
  { name:"Priya Sharma",  xp:2840, streak:12, modules:5 },
  { name:"Rahul Gupta",   xp:2310, streak:8,  modules:4 },
  { name:"Sunita Devi",   xp:1980, streak:5,  modules:4 },
  { name:"Amit Kumar",    xp:1650, streak:3,  modules:3 },
  { name:"Kavita Singh",  xp:1200, streak:1,  modules:2 },
];

const BADGES = [
  { id:"first_quiz",      name:"First Quiz",    emoji:"🎯" },
  { id:"perfect_score",   name:"Gold Standard", emoji:"🏆" },
  { id:"streak_3",        name:"On Fire",        emoji:"🔥" },
  { id:"streak_7",        name:"Diamond Habit",  emoji:"💎" },
  { id:"module_complete", name:"Module Master",  emoji:"⭐" },
  { id:"all_modules",     name:"Grand Master",   emoji:"👑" },
  { id:"speed_demon",     name:"Speed Demon",    emoji:"⚡" },
  { id:"scholar",         name:"Scholar",        emoji:"📚" },
];

const FALLBACK_QUESTIONS = [
  { q:"What is the gold purity of a 22kt jewellery piece?",     opts:["A) 75%","B) 99.9%","C) 91.6%","D) 58.5%"],                                             ans:"C", exp:"22kt = 916 fineness = 91.6% pure gold — the most common for plain jewellery in India." },
  { q:"HUID stands for:",                                        opts:["A) Hallmark Universal ID","B) Hallmark Unique Identification","C) High Unity ID","D) Hallmark Unit Index"], ans:"B", exp:"HUID = Hallmark Unique Identification — a 6-digit alphanumeric code per piece." },
  { q:"Which factor most affects a diamond's brilliance?",      opts:["A) Carat","B) Colour","C) Clarity","D) Cut"],                                           ans:"D", exp:"Cut determines how light reflects and is the most important factor for beauty." },
  { q:"GST on gold jewellery in India is:",                     opts:["A) 5%","B) 18%","C) 3%","D) 1%"],                                                        ans:"C", exp:"GST on gold jewellery is 3% applied to gold value plus making charge." },
  { q:"Polki jewellery uses which type of diamond?",            opts:["A) Cut diamonds","B) Synthetic stones","C) Uncut natural diamonds","D) Glass"],         ans:"C", exp:"Polki uses uncut natural diamonds in raw form, set with foil backing." },
];

// ─── STYLE HELPERS ────────────────────────────────────────────────────────────
const S = {
  app:{ fontFamily:"'DM Sans', sans-serif", background:"#0D0D0D", minHeight:"100vh", color:"#F0EDE8" },
  card:(bg="#1A1A1A", border="#2A2A2A") => ({ background:bg, border:`1px solid ${border}`, borderRadius:16, padding:"20px 24px" }),
  h1:{ fontFamily:"'Syne', sans-serif", fontSize:28, fontWeight:800, color:"#F0EDE8", margin:0 },
  h2:{ fontFamily:"'Syne', sans-serif", fontSize:20, fontWeight:700, color:"#F0EDE8", margin:0 },
  h3:{ fontFamily:"'Syne', sans-serif", fontSize:15, fontWeight:600, color:"#F0EDE8", margin:0 },
  body:{ fontSize:14, color:"#9A9590", lineHeight:1.6, margin:0 },
  pill:(bg, color) => ({ background:bg, color, fontSize:11, fontWeight:600, padding:"3px 10px", borderRadius:20, display:"inline-block", letterSpacing:"0.03em" }),
  btn:(bg="#B8860B", color="#0D0D0D") => ({ background:bg, color, border:"none", borderRadius:10, padding:"10px 20px", fontSize:14, fontWeight:600, cursor:"pointer", transition:"all 0.15s", fontFamily:"'DM Sans', sans-serif" }),
  btnGhost:{ background:"transparent", color:"#B8860B", border:"1px solid #B8860B44", borderRadius:10, padding:"9px 20px", fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans', sans-serif" },
  xpTrack:{ height:6, borderRadius:3, background:"#2A2A2A", position:"relative", overflow:"hidden" },
  xpFill:(pct, color="#B8860B") => ({ position:"absolute", left:0, top:0, bottom:0, width:`${pct}%`, background:color, borderRadius:3, transition:"width 0.6s cubic-bezier(.4,0,.2,1)" }),
};

// ─── READING SCREEN — own component so hooks are at top level ─────────────────
function ReadingScreen({ mod, onBack, onTakeQuiz }) {
  const [readPct, setReadPct] = useState(0);
  const scrollRef = useRef(null);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const total = el.scrollHeight - el.clientHeight;
    if (total <= 0) { setReadPct(100); return; }
    setReadPct(Math.min(100, Math.round((el.scrollTop / total) * 100)));
  }, []);

  const paragraphs = mod.content.split("\n\n").filter(Boolean);

  return (
    <div style={{ ...S.app, display:"flex", flexDirection:"column" }}>
      <link rel="stylesheet" href={FONT_LINK} />
      <div style={{ background:"#111", borderBottom:"1px solid #222", padding:"14px 20px", display:"flex", alignItems:"center", gap:14, position:"sticky", top:0, zIndex:10 }}>
        <button onClick={onBack} style={{ background:"none", border:"none", color:"#666", cursor:"pointer", fontSize:22, lineHeight:1, padding:0 }}>←</button>
        <span style={{ fontSize:22 }}>{mod.emoji}</span>
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:"'Syne', sans-serif", fontSize:14, fontWeight:600, marginBottom:5 }}>{mod.title}</div>
          <div style={{ ...S.xpTrack }}>
            <div style={{ ...S.xpFill(readPct, mod.color) }} />
          </div>
        </div>
        <div style={{ fontSize:12, color:mod.color, fontWeight:700, minWidth:36, textAlign:"right" }}>{readPct}%</div>
      </div>

      <div ref={scrollRef} onScroll={handleScroll}
        style={{ flex:1, overflowY:"auto", padding:"24px 20px", maxWidth:680, margin:"0 auto", width:"100%", boxSizing:"border-box" }}>
        <div style={{ marginBottom:28 }}>
          <div style={{ ...S.h1, marginBottom:10 }}>{mod.title}</div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <span style={S.pill(mod.color+"22", mod.color)}>{mod.level}</span>
            <span style={S.pill("#222","#555")}>⏱ {mod.duration}</span>
          </div>
        </div>

        {paragraphs.map((para, i) => {
          const isHeader = para === para.toUpperCase() && para.length < 80 && !para.includes(".");
          return (
            <div key={i} style={{ marginBottom: isHeader ? 4 : 20 }}>
              {isHeader
                ? <div style={{ fontFamily:"'Syne', sans-serif", fontSize:11, fontWeight:700, color:mod.color, letterSpacing:"0.12em", marginTop: i > 0 ? 28 : 0 }}>{para}</div>
                : <div style={{ fontSize:15, color:"#C8C4BE", lineHeight:1.9 }}>{para}</div>
              }
            </div>
          );
        })}
        <div style={{ height:100 }} />
      </div>

      <div style={{ background:"#111", borderTop:"1px solid #222", padding:"16px 20px" }}>
        {readPct >= 40
          ? <button style={{ ...S.btn(mod.color,"#0D0D0D"), width:"100%", padding:"15px", borderRadius:12, fontSize:15 }} onClick={onTakeQuiz}>
              Take Quiz — Earn XP ⚡
            </button>
          : <div style={{ textAlign:"center", fontSize:13, color:"#444", padding:"6px 0" }}>
              Keep reading… {readPct}% done
            </div>
        }
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen,        setScreen]        = useState("login");
  const [modules,       setModules]       = useState(INITIAL_MODULES);
  const [readingModule, setReadingModule] = useState(null);
  const [activeModule,  setActiveModule]  = useState(null);
  const [userXP,        setUserXP]        = useState(1200);
  const [userBadges,    setUserBadges]    = useState(["first_quiz","scholar"]);
  const [userStreak]                      = useState(4);
  const [userProgress,  setUserProgress]  = useState({});
  const [notification,  setNotification]  = useState(null);
  const [confetti,      setConfetti]      = useState([]);

  // Quiz
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [quizIdx,       setQuizIdx]       = useState(0);
  const [quizScore,     setQuizScore]     = useState(0);
  const [quizAnswer,    setQuizAnswer]    = useState(null);
  const [quizDone,      setQuizDone]      = useState(false);
  const [quizStartTime, setQuizStartTime] = useState(null);
  const [isGenerating,  setIsGenerating]  = useState(false);

  // Admin
  const [adminTab,      setAdminTab]      = useState("modules");
  const [editingMod,    setEditingMod]    = useState(null);
  const [editTitle,     setEditTitle]     = useState("");
  const [editContent,   setEditContent]   = useState("");
  const [showNewForm,   setShowNewForm]   = useState(false);
  const [newMod,        setNewMod]        = useState({ title:"", emoji:"⭐", color:"#B8860B", level:"Core" });
  const [newModTopic,   setNewModTopic]   = useState("");
  const [genAI,         setGenAI]         = useState(false);

  // ── Helpers ──
  const notify = (msg, type="success") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3200);
  };

  const spawnConfetti = () => {
    const items = Array.from({ length:16 }, (_, i) => ({
      id: Date.now()+i, x:Math.random()*100,
      color:["#B8860B","#FFD700","#FFF","#C0392B","#1D9E75"][i%5],
      size:6+Math.random()*8, delay:Math.random()*0.5,
    }));
    setConfetti(items);
    setTimeout(() => setConfetti([]), 2500);
  };

  const addXP = (amount, reason) => {
    setUserXP(p => p + amount);
    notify(`+${amount} XP — ${reason}! 🎉`);
    spawnConfetti();
  };

  const awardBadge = (id) => {
    setUserBadges(prev => {
      if (prev.includes(id)) return prev;
      const b = BADGES.find(x => x.id === id);
      if (b) setTimeout(() => notify(`Badge unlocked: ${b.emoji} ${b.name}!`, "badge"), 1200);
      return [...prev, id];
    });
  };

  // ── Quiz ──
  const generateQuiz = async (mod) => {
    setIsGenerating(true);
    setQuizQuestions([]);
    setQuizIdx(0);
    setQuizScore(0);
    setQuizDone(false);
    setQuizAnswer(null);
    setQuizStartTime(Date.now());
    setActiveModule(mod);
    setScreen("quiz");

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514",
          max_tokens:1000,
          system:`You are a quiz generator for a jewellery store training app in Karol Bagh, Delhi. Generate exactly 5 multiple-choice questions based ONLY on the provided training content. Return ONLY a valid JSON array — no markdown fences, no extra text. Each item: {"q":"question","opts":["A) ...","B) ...","C) ...","D) ..."],"ans":"A","exp":"1-2 sentence explanation"}. Make questions practical and floor-relevant. Use Indian context — rupees, Delhi market, Hinglish terms. Generate different questions every time.`,
          messages:[{ role:"user", content:`Module: ${mod.title}\n\n${mod.content}\n\nGenerate 5 fresh questions.` }]
        })
      });
      const data = await res.json();
      const raw = data.content?.[0]?.text || "";
      const clean = raw.replace(/```json|```/gi,"").trim();
      const qs = JSON.parse(clean);
      setQuizQuestions(Array.isArray(qs) && qs.length ? qs : FALLBACK_QUESTIONS);
    } catch {
      setQuizQuestions(FALLBACK_QUESTIONS);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAnswer = (opt) => {
    if (quizAnswer !== null) return;
    const q = quizQuestions[quizIdx];
    const correct = opt.startsWith(q.ans);
    setQuizAnswer(opt);
    if (correct) setQuizScore(p => p + 1);
  };

  const nextQuestion = () => {
    if (quizIdx < quizQuestions.length - 1) {
      setQuizIdx(p => p + 1);
      setQuizAnswer(null);
      return;
    }
    // Last question — finalize (score already incremented via handleAnswer)
    setQuizDone(true);
    // Use functional update to get latest score
    setQuizScore(finalScore => {
      const total = quizQuestions.length;
      const pct = Math.round(finalScore / total * 100);
      const elapsed = (Date.now() - quizStartTime) / 1000;
      addXP(finalScore * 40 + (finalScore === total ? 100 : 0), `${activeModule.title} quiz`);
      awardBadge("first_quiz");
      if (finalScore === total) awardBadge("perfect_score");
      if (elapsed < 60) awardBadge("speed_demon");
      if (pct >= 70) awardBadge("module_complete");
      setUserProgress(prev => {
        const p = { ...prev };
        if (!p[activeModule.id]) p[activeModule.id] = {};
        p[activeModule.id].quizDone = true;
        p[activeModule.id].bestScore = Math.max(pct, p[activeModule.id]?.bestScore || 0);
        p[activeModule.id].attempts = (p[activeModule.id]?.attempts || 0) + 1;
        return p;
      });
      return finalScore;
    });
  };

  // ── AI content gen ──
  const generateContent = async () => {
    if (!newModTopic.trim()) return;
    setGenAI(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514",
          max_tokens:1000,
          system:`You are a jewellery training content writer for Sun Sea Jewellers International, Karol Bagh, New Delhi. Write training module content in plain paragraphs. Use section headers in ALL CAPS on their own line. Use simple English with natural Hinglish. Practical, floor-selling focused, Delhi market specific. Under 700 words. No bullet symbols, no asterisks, no markdown.`,
          messages:[{ role:"user", content:`Write training content for: ${newModTopic}\n\nInclude key concepts, how to explain to customers, common questions, selling tips, what NOT to do.` }]
        })
      });
      const data = await res.json();
      setEditContent(data.content?.[0]?.text || "");
    } catch {
      setEditContent(`${newModTopic.toUpperCase()}\n\nAdd your training content here.\n\nCOMMON CUSTOMER QUESTIONS\n\nAdd the most common questions here.\n\nSELLING TIPS\n\nAdd specific tips for your staff here.`);
    } finally {
      setGenAI(false);
    }
  };

  // ── Computed ──
  const lvl     = Math.floor(userXP / 500) + 1;
  const xpToNext = 500 - (userXP % 500);
  const xpPct   = ((userXP % 500) / 500) * 100;

  const Notification = () => notification ? (
    <div style={{ position:"fixed", top:16, left:"50%", transform:"translateX(-50%)", zIndex:1000,
      background: notification.type==="badge" ? "#7D3C98":"#1D9E75", color:"#fff",
      padding:"10px 20px", borderRadius:10, fontSize:13, fontWeight:600, whiteSpace:"nowrap",
      boxShadow:"0 4px 24px rgba(0,0,0,0.5)" }}>
      {notification.msg}
    </div>
  ) : null;

  const Confetti = () => (
    <>
      {confetti.map(c => (
        <div key={c.id} style={{ position:"fixed", top:"-10px", left:`${c.x}%`, width:c.size, height:c.size,
          background:c.color, borderRadius:2, animation:`fall 1.8s ${c.delay}s ease-in forwards`,
          zIndex:999, pointerEvents:"none" }} />
      ))}
    </>
  );

  // ────────────────────────────────────────────────────────────────────────────
  // READING
  // ────────────────────────────────────────────────────────────────────────────
  if (screen === "reading" && readingModule) {
    return (
      <ReadingScreen
        mod={readingModule}
        onBack={() => setScreen("home")}
        onTakeQuiz={() => { awardBadge("scholar"); generateQuiz(readingModule); }}
      />
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // QUIZ
  // ────────────────────────────────────────────────────────────────────────────
  if (screen === "quiz") {
    const currentQ = quizQuestions[quizIdx];
    return (
      <div style={{ ...S.app, display:"flex", flexDirection:"column" }}>
        <link rel="stylesheet" href={FONT_LINK} />
        <style>{`@keyframes fall{to{transform:translateY(110vh) rotate(720deg);opacity:0}} @keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <Confetti />
        <Notification />

        <div style={{ background:"#111", borderBottom:"1px solid #222", padding:"14px 20px", display:"flex", alignItems:"center", gap:14 }}>
          <button onClick={() => setScreen("home")} style={{ background:"none", border:"none", color:"#666", cursor:"pointer", fontSize:22, lineHeight:1, padding:0 }}>←</button>
          <span style={{ fontSize:20 }}>{activeModule?.emoji}</span>
          <div style={{ flex:1, fontFamily:"'Syne', sans-serif", fontSize:14, fontWeight:600 }}>{activeModule?.title} Quiz</div>
          {!quizDone && !isGenerating && quizQuestions.length > 0 && (
            <span style={S.pill("#222","#B8860B")}>{quizIdx+1}/{quizQuestions.length}</span>
          )}
        </div>

        <div style={{ flex:1, overflowY:"auto", padding:"24px 20px", maxWidth:580, margin:"0 auto", width:"100%", boxSizing:"border-box" }}>

          {isGenerating && (
            <div style={{ textAlign:"center", paddingTop:80 }}>
              <div style={{ fontSize:48, marginBottom:16, display:"inline-block", animation:"spin 1s linear infinite" }}>⚙️</div>
              <div style={{ ...S.h2, marginBottom:8 }}>Generating fresh questions…</div>
              <div style={{ ...S.body }}>AI is reading the module content</div>
            </div>
          )}

          {!isGenerating && quizDone && (
            <div>
              <div style={{ textAlign:"center", paddingTop:24, paddingBottom:32 }}>
                <div style={{ fontSize:64, marginBottom:12 }}>
                  {quizScore === quizQuestions.length ? "🏆" : quizScore >= Math.ceil(quizQuestions.length*0.7) ? "🌟" : "💪"}
                </div>
                <div style={{ fontFamily:"'Syne', sans-serif", fontSize:42, fontWeight:800, marginBottom:6 }}>{quizScore}/{quizQuestions.length}</div>
                <div style={{ fontSize:15, color:"#888", marginBottom:28 }}>
                  {quizScore === quizQuestions.length ? "Perfect! Gold Standard!" :
                   quizScore >= Math.ceil(quizQuestions.length*0.7) ? "Passed! Great work." :
                   "Keep practicing — you can do it!"}
                </div>
                <div style={{ ...S.card(), textAlign:"left", marginBottom:16 }}>
                  <div style={{ fontSize:11, color:"#555", fontFamily:"'Syne', sans-serif", letterSpacing:"0.08em", marginBottom:10 }}>WHAT YOU EARNED</div>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div style={{ fontFamily:"'Syne', sans-serif", fontSize:28, fontWeight:800, color:"#B8860B" }}>
                      +{quizScore*40 + (quizScore===quizQuestions.length?100:0)} XP
                    </div>
                    <div style={{ fontSize:13, color:"#666" }}>{Math.round(quizScore/quizQuestions.length*100)}%</div>
                  </div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  <button style={{ ...S.btn(activeModule?.color||"#B8860B","#0D0D0D"), padding:"14px", borderRadius:12 }}
                    onClick={() => generateQuiz(activeModule)}>
                    🔁 New Questions — Try Again
                  </button>
                  <button style={{ ...S.btn("#1A1A1A","#C8C4BE"), padding:"14px", borderRadius:12, border:"1px solid #333" }}
                    onClick={() => setScreen("home")}>
                    ← Back to Home
                  </button>
                </div>
              </div>
              <div style={{ fontFamily:"'Syne', sans-serif", fontSize:13, fontWeight:600, marginBottom:12 }}>Review Answers</div>
              {quizQuestions.map((q, i) => (
                <div key={i} style={{ ...S.card(), marginBottom:10 }}>
                  <div style={{ fontSize:12, color:"#555", marginBottom:5 }}>Q{i+1}</div>
                  <div style={{ fontSize:14, color:"#F0EDE8", marginBottom:8 }}>{q.q}</div>
                  <div style={{ fontSize:13, color:"#4ADE80", marginBottom:5 }}>✓ {q.opts.find(o=>o.startsWith(q.ans))}</div>
                  <div style={{ fontSize:12, color:"#666", fontStyle:"italic" }}>{q.exp}</div>
                </div>
              ))}
            </div>
          )}

          {!isGenerating && !quizDone && currentQ && (
            <div>
              <div style={{ ...S.xpTrack, marginBottom:28 }}>
                <div style={{ ...S.xpFill((quizIdx/quizQuestions.length)*100, activeModule?.color||"#B8860B") }} />
              </div>
              <div style={{ fontFamily:"'Syne', sans-serif", fontSize:18, fontWeight:700, lineHeight:1.45, marginBottom:28, color:"#F0EDE8" }}>
                {currentQ.q}
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:24 }}>
                {currentQ.opts.map(opt => {
                  const chosen  = quizAnswer === opt;
                  const correct = opt.startsWith(currentQ.ans);
                  const reveal  = quizAnswer !== null;
                  let bg="#1A1A1A", border="#2A2A2A", color="#F0EDE8";
                  if (reveal && correct)        { bg="#0D2B1A"; border="#1D9E75"; color="#4ADE80"; }
                  else if (reveal && chosen)    { bg="#2B0D0D"; border="#C0392B"; color="#F87171"; }
                  return (
                    <button key={opt} onClick={() => handleAnswer(opt)}
                      style={{ background:bg, border:`1.5px solid ${border}`, borderRadius:12, padding:"14px 18px",
                        textAlign:"left", fontSize:14, color, cursor:quizAnswer?"default":"pointer",
                        transition:"all 0.18s", fontFamily:"'DM Sans', sans-serif",
                        display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <span>{opt}</span>
                      {reveal && correct && <span>✓</span>}
                      {reveal && chosen && !correct && <span>✗</span>}
                    </button>
                  );
                })}
              </div>
              {quizAnswer && (
                <div>
                  <div style={{ background:"#0D1F15", border:"1px solid #1D9E7533", borderRadius:12, padding:"14px 16px", marginBottom:16 }}>
                    <div style={{ fontSize:13, color:"#6EE7B7", lineHeight:1.65 }}>{currentQ.exp}</div>
                  </div>
                  <button style={{ ...S.btn(activeModule?.color||"#B8860B","#0D0D0D"), width:"100%", padding:"14px", borderRadius:12, fontSize:15 }}
                    onClick={nextQuestion}>
                    {quizIdx < quizQuestions.length-1 ? "Next Question →" : "See Results 🏁"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ADMIN — module editor
  // ────────────────────────────────────────────────────────────────────────────
  if (screen === "admin" && editingMod) {
    return (
      <div style={{ ...S.app, display:"flex", flexDirection:"column" }}>
        <link rel="stylesheet" href={FONT_LINK} />
        <Notification />
        <div style={{ background:"#111", borderBottom:"1px solid #222", padding:"14px 20px", display:"flex", alignItems:"center", gap:14 }}>
          <button onClick={() => setEditingMod(null)} style={{ background:"none", border:"none", color:"#666", cursor:"pointer", fontSize:22, lineHeight:1, padding:0 }}>←</button>
          <div style={{ ...S.h3 }}>Editing: {editingMod.title}</div>
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:"20px", maxWidth:720, margin:"0 auto", width:"100%", boxSizing:"border-box" }}>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:11, color:"#555", marginBottom:6, fontFamily:"'Syne', sans-serif", letterSpacing:"0.08em" }}>MODULE TITLE</div>
            <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
              style={{ width:"100%", background:"#1A1A1A", border:"1px solid #333", borderRadius:10, padding:"12px 14px", color:"#F0EDE8", fontSize:15, fontFamily:"'DM Sans', sans-serif", boxSizing:"border-box" }} />
          </div>
          <div style={{ fontSize:11, color:"#555", marginBottom:4, fontFamily:"'Syne', sans-serif", letterSpacing:"0.08em" }}>TRAINING CONTENT</div>
          <div style={{ fontSize:12, color:"#444", marginBottom:8 }}>Edit freely — AI generates quiz questions from whatever you write here. No special formatting needed.</div>
          <textarea value={editContent} onChange={e => setEditContent(e.target.value)}
            style={{ width:"100%", minHeight:420, background:"#1A1A1A", border:"1px solid #333", borderRadius:10, padding:"14px", color:"#C8C4BE", fontSize:13, lineHeight:1.85, fontFamily:"'DM Sans', sans-serif", resize:"vertical", boxSizing:"border-box" }} />
          <div style={{ display:"flex", gap:10, marginTop:16 }}>
            <button style={{ ...S.btn("#B8860B","#0D0D0D"), flex:1, padding:"13px", borderRadius:10 }}
              onClick={() => {
                setModules(p => p.map(m => m.id===editingMod.id ? {...m, title:editTitle, content:editContent} : m));
                setEditingMod(null);
                notify("Module updated — quiz will use new content immediately.");
              }}>
              Save Changes
            </button>
            <button style={{ ...S.btn("#1A1A1A","#888"), flex:1, padding:"13px", borderRadius:10, border:"1px solid #333" }}
              onClick={() => setEditingMod(null)}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ADMIN — new module form
  // ────────────────────────────────────────────────────────────────────────────
  if (screen === "admin" && showNewForm) {
    return (
      <div style={{ ...S.app, display:"flex", flexDirection:"column" }}>
        <link rel="stylesheet" href={FONT_LINK} />
        <Notification />
        <div style={{ background:"#111", borderBottom:"1px solid #222", padding:"14px 20px", display:"flex", alignItems:"center", gap:14 }}>
          <button onClick={() => { setShowNewForm(false); setEditContent(""); }} style={{ background:"none", border:"none", color:"#666", cursor:"pointer", fontSize:22, lineHeight:1, padding:0 }}>←</button>
          <div style={{ ...S.h3 }}>Create New Module</div>
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:"20px", maxWidth:680, margin:"0 auto", width:"100%", boxSizing:"border-box" }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
            <div>
              <div style={{ fontSize:11, color:"#555", marginBottom:6, fontFamily:"'Syne', sans-serif" }}>MODULE TITLE</div>
              <input placeholder="eg. Silver Jewellery" value={newMod.title}
                onChange={e => setNewMod(p=>({...p,title:e.target.value}))}
                style={{ width:"100%", background:"#1A1A1A", border:"1px solid #333", borderRadius:10, padding:"12px 14px", color:"#F0EDE8", fontSize:14, fontFamily:"'DM Sans', sans-serif", boxSizing:"border-box" }} />
            </div>
            <div>
              <div style={{ fontSize:11, color:"#555", marginBottom:6, fontFamily:"'Syne', sans-serif" }}>EMOJI</div>
              <input placeholder="🥈" value={newMod.emoji}
                onChange={e => setNewMod(p=>({...p,emoji:e.target.value}))}
                style={{ width:"100%", background:"#1A1A1A", border:"1px solid #333", borderRadius:10, padding:"10px 14px", color:"#F0EDE8", fontSize:24, fontFamily:"'DM Sans', sans-serif", boxSizing:"border-box" }} />
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:20 }}>
            <div>
              <div style={{ fontSize:11, color:"#555", marginBottom:6, fontFamily:"'Syne', sans-serif" }}>ACCENT COLOUR</div>
              <input type="color" value={newMod.color} onChange={e=>setNewMod(p=>({...p,color:e.target.value}))}
                style={{ width:"100%", height:44, background:"#1A1A1A", border:"1px solid #333", borderRadius:10, cursor:"pointer", padding:4, boxSizing:"border-box" }} />
            </div>
            <div>
              <div style={{ fontSize:11, color:"#555", marginBottom:6, fontFamily:"'Syne', sans-serif" }}>LEVEL</div>
              <select value={newMod.level} onChange={e=>setNewMod(p=>({...p,level:e.target.value}))}
                style={{ width:"100%", background:"#1A1A1A", border:"1px solid #333", borderRadius:10, padding:"12px 14px", color:"#F0EDE8", fontSize:14, fontFamily:"'DM Sans', sans-serif", boxSizing:"border-box" }}>
                {["Foundation","Core","Advanced","Operations"].map(l=><option key={l}>{l}</option>)}
              </select>
            </div>
          </div>

          <div style={{ ...S.card("#0D1200","#B8860B33"), marginBottom:16 }}>
            <div style={{ fontSize:11, color:"#B8860B", marginBottom:8, fontFamily:"'Syne', sans-serif", fontWeight:700, letterSpacing:"0.08em" }}>✨ AI CONTENT GENERATOR</div>
            <div style={{ fontSize:13, color:"#666", marginBottom:12 }}>Describe what this module should cover — Claude writes the full training content for you.</div>
            <textarea placeholder="eg. How to sell silver jewellery — 925 sterling, oxidised silver, cleaning tips, gifting angle, customer objections..." value={newModTopic} onChange={e=>setNewModTopic(e.target.value)}
              style={{ width:"100%", height:80, background:"#1A1A1A", border:"1px solid #333", borderRadius:10, padding:"12px", color:"#C8C4BE", fontSize:13, fontFamily:"'DM Sans', sans-serif", resize:"none", boxSizing:"border-box" }} />
            <button style={{ ...S.btn(genAI?"#333":"#B8860B", genAI?"#555":"#0D0D0D"), width:"100%", padding:"12px", borderRadius:10, marginTop:10 }}
              onClick={generateContent} disabled={genAI}>
              {genAI ? "⏳ Generating…" : "✨ Generate Training Content"}
            </button>
          </div>

          <div style={{ fontSize:11, color:"#555", marginBottom:6, fontFamily:"'Syne', sans-serif" }}>TRAINING CONTENT</div>
          <textarea value={editContent} onChange={e=>setEditContent(e.target.value)}
            placeholder="AI content appears here, or type manually…"
            style={{ width:"100%", minHeight:280, background:"#1A1A1A", border:"1px solid #333", borderRadius:10, padding:"14px", color:"#C8C4BE", fontSize:13, lineHeight:1.85, fontFamily:"'DM Sans', sans-serif", resize:"vertical", boxSizing:"border-box" }} />

          <button style={{ ...S.btn("#B8860B","#0D0D0D"), width:"100%", padding:"14px", borderRadius:12, marginTop:16, fontSize:15, opacity:(!newMod.title||!editContent)?0.4:1 }}
            disabled={!newMod.title||!editContent}
            onClick={() => {
              setModules(p=>[...p,{ id:"m"+Date.now(), title:newMod.title, emoji:newMod.emoji, color:newMod.color, level:newMod.level, duration:"2–3 hrs", content:editContent }]);
              setShowNewForm(false); setEditContent(""); setNewModTopic(""); setNewMod({title:"",emoji:"⭐",color:"#B8860B",level:"Core"});
              notify("Module published! Staff can access it now.");
            }}>
            🚀 Publish to Staff
          </button>
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ADMIN MAIN
  // ────────────────────────────────────────────────────────────────────────────
  if (screen === "admin") {
    return (
      <div style={{ ...S.app, display:"flex", flexDirection:"column" }}>
        <link rel="stylesheet" href={FONT_LINK} />
        <Notification />
        <div style={{ background:"#111", borderBottom:"1px solid #1A1A1A", padding:"14px 20px", display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ fontSize:22 }}>⚙️</span>
          <div style={{ flex:1 }}>
            <div style={{ ...S.h3 }}>Super Admin Panel</div>
            <div style={{ fontSize:12, color:"#444" }}>Sun Sea Jewellers</div>
          </div>
          <button style={{ ...S.btn("#1A1A1A","#666"), padding:"8px 14px", border:"1px solid #333", fontSize:12, borderRadius:8 }}
            onClick={()=>setScreen("login")}>Exit</button>
        </div>
        <div style={{ display:"flex", borderBottom:"1px solid #222", padding:"0 16px" }}>
          {["modules","staff","analytics"].map(t=>(
            <button key={t} onClick={()=>setAdminTab(t)}
              style={{ background:"none", border:"none", padding:"13px 16px", fontSize:13, fontWeight:600, cursor:"pointer",
                color:adminTab===t?"#B8860B":"#555", borderBottom:adminTab===t?"2px solid #B8860B":"2px solid transparent",
                fontFamily:"'Syne', sans-serif", textTransform:"capitalize" }}>
              {t}
            </button>
          ))}
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:"20px", maxWidth:800, margin:"0 auto", width:"100%", boxSizing:"border-box" }}>

          {adminTab==="modules" && (
            <div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
                <div>
                  <div style={S.h2}>Training Modules</div>
                  <div style={{ fontSize:12, color:"#444", marginTop:4 }}>{modules.length} modules live</div>
                </div>
                <button style={{ ...S.btn("#B8860B","#0D0D0D"), padding:"10px 18px", borderRadius:10 }}
                  onClick={()=>{setShowNewForm(true);setEditContent("");}}>+ New Module</button>
              </div>
              {modules.map(m=>(
                <div key={m.id} style={{ ...S.card(), marginBottom:10, display:"flex", alignItems:"center", gap:16 }}>
                  <div style={{ width:44, height:44, borderRadius:12, background:m.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>{m.emoji}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ ...S.h3, marginBottom:6 }}>{m.title}</div>
                    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                      <span style={S.pill(m.color+"22",m.color)}>{m.level}</span>
                      <span style={S.pill("#222","#444")}>{m.content.split(" ").length} words</span>
                    </div>
                  </div>
                  <button style={{ ...S.btnGhost, padding:"8px 14px", fontSize:12, borderRadius:8 }}
                    onClick={()=>{setEditingMod(m);setEditTitle(m.title);setEditContent(m.content);}}>
                    Edit
                  </button>
                </div>
              ))}
              <div style={{ ...S.card("#0D1A0D","#1D9E7522"), marginTop:20 }}>
                <div style={{ fontSize:11, color:"#4ADE80", marginBottom:6, fontFamily:"'Syne', sans-serif", letterSpacing:"0.08em" }}>HOW AI QUIZZES WORK</div>
                <div style={{ fontSize:13, color:"#555", lineHeight:1.7 }}>
                  Every "Take Quiz" call sends the module content to Claude which generates 5 fresh questions each time. No two quizzes are identical. Edit content → quiz updates instantly. New module → quizzes live immediately.
                </div>
              </div>
            </div>
          )}

          {adminTab==="staff" && (
            <div>
              <div style={{ ...S.h2, marginBottom:20 }}>Staff Leaderboard</div>
              {INITIAL_LEADERBOARD.map((s,i)=>(
                <div key={i} style={{ ...S.card(), marginBottom:10, display:"flex", alignItems:"center", gap:16 }}>
                  <div style={{ width:32, height:32, borderRadius:8, background:["#B8860B22","#33333344","#C0392B22","#1A1A1A","#1A1A1A"][i],
                    display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Syne', sans-serif",
                    fontWeight:800, fontSize:14, color:["#B8860B","#888","#C0392B","#444","#333"][i] }}>
                    {i+1}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ ...S.h3, marginBottom:5 }}>{s.name}</div>
                    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                      <span style={S.pill("#B8860B22","#B8860B")}>{s.xp.toLocaleString()} XP</span>
                      <span style={S.pill("#222","#555")}>🔥 {s.streak}d</span>
                      <span style={S.pill("#222","#444")}>{s.modules} modules</span>
                    </div>
                  </div>
                  <span style={{ fontSize:20 }}>{["🥇","🥈","🥉","",""][i]}</span>
                </div>
              ))}
            </div>
          )}

          {adminTab==="analytics" && (
            <div>
              <div style={{ ...S.h2, marginBottom:20 }}>Analytics</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:24 }}>
                {[{label:"Active Staff",val:"12",icon:"👥",color:"#B8860B"},{label:"Quizzes This Week",val:"47",icon:"📝",color:"#1D6B5A"},{label:"Avg Score",val:"74%",icon:"📊",color:"#7D3C98"},{label:"Modules Completed",val:"38",icon:"✅",color:"#C0392B"}].map(m=>(
                  <div key={m.label} style={{ ...S.card(), textAlign:"center" }}>
                    <div style={{ fontSize:28, marginBottom:8 }}>{m.icon}</div>
                    <div style={{ fontFamily:"'Syne', sans-serif", fontSize:28, fontWeight:800, color:m.color }}>{m.val}</div>
                    <div style={{ fontSize:12, color:"#444", marginTop:4 }}>{m.label}</div>
                  </div>
                ))}
              </div>
              {modules.slice(0,5).map((m,i)=>{ const sc=[82,71,68,79,73]; return (
                <div key={m.id} style={{ ...S.card(), marginBottom:8 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                    <div style={{ fontSize:13 }}>{m.emoji} {m.title}</div>
                    <div style={{ fontSize:12, color:m.color, fontWeight:600 }}>{sc[i]||70}%</div>
                  </div>
                  <div style={{ ...S.xpTrack }}><div style={{ ...S.xpFill(sc[i]||70, m.color) }} /></div>
                </div>
              );})}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // LOGIN
  // ────────────────────────────────────────────────────────────────────────────
  if (screen === "login") {
    return (
      <div style={{ ...S.app, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
        <link rel="stylesheet" href={FONT_LINK} />
        <div style={{ width:"100%", maxWidth:400 }}>
          <div style={{ textAlign:"center", marginBottom:48 }}>
            <div style={{ fontSize:60, marginBottom:16 }}>💎</div>
            <div style={{ fontFamily:"'Syne', sans-serif", fontSize:34, fontWeight:800, marginBottom:8 }}>SunSea Academy</div>
            <div style={{ fontSize:14, color:"#444" }}>Sun Sea Jewellers International · Karol Bagh, New Delhi</div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <button style={{ ...S.btn("#B8860B","#0D0D0D"), padding:"17px 20px", fontSize:16, borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}
              onClick={()=>{setScreen("home");}}>
              <span>👤</span> I'm a Staff Member
            </button>
            <button style={{ ...S.btn("#1A1A1A","#C8C4BE"), padding:"17px 20px", fontSize:16, borderRadius:14, border:"1px solid #333", display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}
              onClick={()=>{setScreen("admin");}}>
              <span>⚙️</span> Super Admin Login
            </button>
          </div>
          <div style={{ textAlign:"center", marginTop:24, fontSize:12, color:"#333" }}>Demo mode — tap to enter</div>
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // HOME (STAFF)
  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ ...S.app, display:"flex", flexDirection:"column" }}>
      <link rel="stylesheet" href={FONT_LINK} />
      <style>{`
        @keyframes fall { to { transform:translateY(110vh) rotate(720deg); opacity:0 } }
        ::-webkit-scrollbar { width:4px }
        ::-webkit-scrollbar-track { background:transparent }
        ::-webkit-scrollbar-thumb { background:#2A2A2A; border-radius:2px }
      `}</style>
      <Confetti />
      <Notification />

      {/* Header */}
      <div style={{ background:"#111", borderBottom:"1px solid #1A1A1A", padding:"16px 20px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
          <div>
            <div style={{ fontFamily:"'Syne', sans-serif", fontSize:10, color:"#444", letterSpacing:"0.12em", marginBottom:4 }}>SUNSEA ACADEMY</div>
            <div style={{ fontFamily:"'Syne', sans-serif", fontSize:18, fontWeight:700 }}>Good morning 👋</div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:11, color:"#444", marginBottom:2 }}>Level {lvl}</div>
            <div style={{ fontFamily:"'Syne', sans-serif", fontSize:15, fontWeight:800, color:"#B8860B" }}>{userXP.toLocaleString()} XP</div>
          </div>
        </div>
        <div style={{ marginBottom:12 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
            <div style={{ fontSize:11, color:"#444" }}>Lvl {lvl}</div>
            <div style={{ fontSize:11, color:"#444" }}>{xpToNext} XP to Lvl {lvl+1}</div>
          </div>
          <div style={{ ...S.xpTrack }}><div style={{ ...S.xpFill(xpPct) }} /></div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <span style={S.pill("#C0392B22","#E74C3C")}>🔥 {userStreak}-day streak</span>
          {userBadges.slice(0,2).map(bid=>{ const b=BADGES.find(x=>x.id===bid); return b?<span key={bid} style={S.pill("#2A2A2A","#666")}>{b.emoji} {b.name}</span>:null; })}
          {userBadges.length>2&&<span style={S.pill("#222","#444")}>+{userBadges.length-2} more</span>}
        </div>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:"20px 16px 110px" }}>

        {/* Daily challenge */}
        <div style={{ background:"#1A1200", border:"1px solid #B8860B33", borderRadius:16, padding:"18px 20px", marginBottom:24, cursor:"pointer" }}
          onClick={()=>{ const m=modules[Math.floor(Math.random()*modules.length)]; generateQuiz(m); }}>
          <div style={{ fontFamily:"'Syne', sans-serif", fontSize:10, color:"#B8860B", letterSpacing:"0.1em", marginBottom:6 }}>⚡ DAILY CHALLENGE</div>
          <div style={{ ...S.h2, marginBottom:4 }}>Random Quiz — +Bonus XP</div>
          <div style={{ fontSize:13, color:"#555", marginBottom:14 }}>Surprise question from any module</div>
          <span style={{ ...S.btn("#B8860B","#0D0D0D"), padding:"9px 18px", borderRadius:8, fontSize:13, display:"inline-block" }}>Start →</span>
        </div>

        {/* Modules */}
        <div style={{ fontFamily:"'Syne', sans-serif", fontSize:10, color:"#444", letterSpacing:"0.12em", marginBottom:14 }}>TRAINING MODULES</div>
        <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:28 }}>
          {modules.map(m=>{
            const prog=userProgress[m.id];
            return (
              <div key={m.id} style={{ ...S.card(), border:`1px solid ${prog?.quizDone?"#1D9E7522":"#222"}` }}>
                <div style={{ display:"flex", gap:14, alignItems:"center", marginBottom:14 }}>
                  <div style={{ width:46, height:46, borderRadius:12, background:m.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0 }}>{m.emoji}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                      <div style={{ ...S.h3 }}>{m.title}</div>
                      {prog?.quizDone&&<span style={S.pill("#0D2B1A","#4ADE80")}>✓ {prog.bestScore}%</span>}
                    </div>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                      <span style={S.pill(m.color+"22",m.color)}>{m.level}</span>
                      <span style={S.pill("#222","#444")}>⏱ {m.duration}</span>
                      {prog?.attempts>0&&<span style={S.pill("#222","#333")}>🔁 {prog.attempts}×</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <button style={{ ...S.btn("#1E1E1E","#C8C4BE"), flex:1, padding:"10px", borderRadius:10, border:"1px solid #2A2A2A", fontSize:13 }}
                    onClick={()=>{ setReadingModule(m); setScreen("reading"); }}>
                    📖 Read
                  </button>
                  <button style={{ ...S.btn(m.color,"#0D0D0D"), flex:1, padding:"10px", borderRadius:10, fontSize:13 }}
                    onClick={()=>generateQuiz(m)}>
                    ⚡ Quiz
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Leaderboard */}
        <div style={{ fontFamily:"'Syne', sans-serif", fontSize:10, color:"#444", letterSpacing:"0.12em", marginBottom:14 }}>LEADERBOARD</div>
        <div style={{ ...S.card(), marginBottom:24 }}>
          {INITIAL_LEADERBOARD.slice(0,3).map((s,i)=>(
            <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:i<2?"1px solid #1A1A1A":"none" }}>
              <div style={{ width:28, height:28, borderRadius:8, background:["#B8860B22","#33333344","#C0392B22"][i], display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Syne', sans-serif", fontWeight:800, fontSize:12, color:["#B8860B","#777","#C0392B"][i] }}>{i+1}</div>
              <div style={{ flex:1, fontSize:13, color:"#C8C4BE" }}>{s.name}</div>
              <div style={{ fontSize:12, color:"#B8860B", fontWeight:600 }}>{s.xp.toLocaleString()} XP</div>
            </div>
          ))}
        </div>

        {/* Badges */}
        <div style={{ fontFamily:"'Syne', sans-serif", fontSize:10, color:"#444", letterSpacing:"0.12em", marginBottom:14 }}>YOUR BADGES</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10 }}>
          {BADGES.map(b=>{
            const earned=userBadges.includes(b.id);
            return (
              <div key={b.id} style={{ ...S.card(), textAlign:"center", padding:"14px 8px", opacity:earned?1:0.25, transition:"opacity 0.3s" }}>
                <div style={{ fontSize:22, marginBottom:5 }}>{b.emoji}</div>
                <div style={{ fontSize:10, fontWeight:600, color:earned?"#F0EDE8":"#555", lineHeight:1.3 }}>{b.name}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom nav */}
      <div style={{ background:"#111", borderTop:"1px solid #1A1A1A", padding:"12px 20px 22px", display:"flex", justifyContent:"space-around", position:"sticky", bottom:0, zIndex:10 }}>
        <button style={{ background:"none", border:"none", color:"#B8860B", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
          <span style={{ fontSize:20 }}>🏠</span>
          <span style={{ fontSize:10, fontFamily:"'Syne', sans-serif", fontWeight:600 }}>Home</span>
        </button>
        <button onClick={()=>{ const m=modules[Math.floor(Math.random()*modules.length)]; generateQuiz(m); }}
          style={{ background:"none", border:"none", color:"#555", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
          <span style={{ fontSize:20 }}>⚡</span>
          <span style={{ fontSize:10, fontFamily:"'Syne', sans-serif", color:"#555" }}>Quick Quiz</span>
        </button>
        <button style={{ background:"none", border:"none", color:"#555", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
          <span style={{ fontSize:20 }}>🏆</span>
          <span style={{ fontSize:10, fontFamily:"'Syne', sans-serif", color:"#555" }}>Rankings</span>
        </button>
      </div>
    </div>
  );
}
