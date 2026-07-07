const fs = require("fs");
const path = require("path");

// ─────────────────────────────────────────────────────────────────────────────
// STRICT FAQ-based support bot (Phase 2).
//
// Company-FAQ.md is the ONLY knowledge base. The bot answers ONLY from it:
//     ## Section Name
//     **N. Question text?**
//     Answer line(s)...
// (parseFaq() also still tolerates the legacy `<!-- key: X -->` / `Q:` / `A:`
//  format — see parseFaq below — so both layouts work.)
//
// Behaviour is deliberately strict — the bot never guesses / hallucinates:
//   • explicit "talk to admin"/"agent" → escalate to a human (WAITING_AGENT)
//   • pure greeting (hi/hello) → a fixed welcome (not an answer to a question)
//   • personal "meri company approved hai kya" → real DB status (approvalReply)
//   • CONFIDENT FAQ match (score >= threshold) → that FAQ's answer, verbatim intent
//   • otherwise (out-of-FAQ / low confidence) → NO fallback/guess/welcome; the
//     conversation is TRANSFERRED to a human agent (caller flips → WAITING_AGENT).
// No external/LLM API call — everything is matched locally and cheaply.
// ─────────────────────────────────────────────────────────────────────────────

const GREETING =
  "Hello! 👋 Main Khetify ka support assistant hoon. Main registration, dashboard, product, inventory, orders aur billing me help kar sakta hoon. Aapko kis cheez me help chahiye? Human ke liye \"Talk to Admin\" type karein.";

const norm = (s) => String(s || "").toLowerCase().replace(/[?.!,;:()"]/g, " ").replace(/\s+/g, " ").trim();
const wordsOf = (s) => norm(s).split(" ").filter(Boolean);

// Words that carry no matching signal (Hinglish + English question glue).
const STOPWORDS = new Set([
  "kya", "hai", "hain", "ka", "ke", "ki", "ko", "me", "mein", "par", "kaise", "kaun",
  "kaha", "kahan", "kyun", "kyu", "hota", "hoti", "hote", "karun", "karna", "kar",
  "karein", "karta", "karti", "sakta", "sakti", "sakte", "hoon", "hu", "ho", "ye",
  "yeh", "wo", "woh", "main", "aur", "se", "ko", "to", "bhi", "ek", "koi", "kuch",
  "jata", "jaata", "jaati", "jaate", "raha", "rahe", "rehta", "liye", "wala", "wale",
  "hone", "hona", "gaya", "gayi", "diya", "dena", "milta", "milti", "milte",
  "the", "a", "an", "of", "for", "can", "how", "what", "where", "when", "why",
  "do", "does", "is", "are", "my", "you", "i", "will", "with", "on", "in", "at",
]);

// Timing words — used for a synergy bonus so "kab tak"/"kitna time" questions
// line up with FAQ questions that talk about time even if the exact words differ.
const TIME_WORDS = new Set([
  "time", "kitna", "kitne", "kitni", "kab", "tak", "der", "samay", "lagta",
  "lagti", "lagega", "lagenge", "duration", "long", "jaldi", "turant", "ghante",
]);

// Levenshtein distance (small strings) for typo tolerance.
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

// Fuzzy token equality: exact, shared prefix, or a small edit distance (typos).
function fuzzyEq(a, b) {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  const short = Math.min(a.length, b.length);
  return lev(a, b) <= (short <= 5 ? 1 : 2);
}

const meaningful = (toks) => toks.filter((t) => t.length >= 3 && !STOPWORDS.has(t));

// ── Parse Company-FAQ.md → [{ section, question, answer, qTokens, sectionTokens, hasTime }]
// Supports BOTH layouts (req 4):
//   • full FAQ format:  ## Section  /  **12. Question?**  /  answer line(s)
//   • legacy key format: <!-- key: billing -->  /  Q: ...  /  A: ...
function parseFaq() {
  try {
    const md = fs.readFileSync(path.join(__dirname, "..", "Company-FAQ.md"), "utf8");
    const lines = md.split(/\r?\n/);
    const entries = [];
    let section = "General", cur = null;
    const qRe = /^\*\*\s*\d+\.\s*(.+?)\s*\*\*\s*$/;   // **12. Question text?**
    const hRe = /^#{2,6}\s+(.+?)\s*$/;                // ## Section (## .. ######)
    const keyRe = /^<!--\s*key:\s*(.+?)\s*-->$/i;     // legacy: <!-- key: billing -->
    const qLineRe = /^Q:\s*(.+?)\s*$/i;               // legacy: Q: ...
    const aLineRe = /^A:\s*(.+?)\s*$/i;               // legacy: A: ...
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line === "---") continue;
      // Legacy key comment → treat the key as the section/category.
      const k = line.match(keyRe);
      if (k) { section = k[1].replace(/[#*]/g, "").trim() || section; cur = null; continue; }
      // Legacy Q:/A: pair.
      const ql = line.match(qLineRe);
      if (ql) { cur = { section, question: ql[1], answer: "" }; entries.push(cur); continue; }
      const al = line.match(aLineRe);
      if (al) { if (cur) cur.answer = cur.answer ? `${cur.answer} ${al[1]}` : al[1]; continue; }
      // Blockquote intro line — ignore (not a heading/question/answer).
      if (line.startsWith(">")) continue;
      const q = line.match(qRe);
      if (q) { cur = { section, question: q[1], answer: "" }; entries.push(cur); continue; }
      const h = line.match(hRe);
      if (h) { section = h[1].replace(/[^\x00-\x7F]/g, "").replace(/[#*]/g, "").trim() || "General"; cur = null; continue; }
      if (cur) cur.answer = cur.answer ? `${cur.answer} ${line}` : line; // answer / continuation
    }
    return entries
      .filter((e) => e.answer)
      .map((e) => {
        const qToks = wordsOf(e.question);
        return {
          ...e,
          qTokens: meaningful(qToks),
          sectionTokens: meaningful(wordsOf(e.section)),
          hasTime: qToks.some((t) => TIME_WORDS.has(t)),
        };
      });
  } catch {
    return [];
  }
}

const ENTRIES = parseFaq();

// ── Intent → keyword map (drives category scoring). User's message is scored
// against each category; the highest-scoring category routes to that category's
// FAQ section(s). Single words are token/fuzzy matched (no false "plan" inside
// "explain"); multi-word phrases are substring matched (weight 2).
// Order matters for tie-breaks: more specific categories first, the broad/
// overlapping ones (approval "status", support) later so they don't hijack ties.
const CATEGORY_KEYWORDS = {
  dashboard: ["dashboard", "option", "options", "module", "modules", "feature", "features", "access", "unlock", "home", "notification", "mobile", "sabhi option", "sab feature"],
  product: ["product", "upload", "publish", "catalog", "image", "price", "variant", "bulk", "category"],
  inventory: ["inventory", "ims", "stock", "warehouse stock", "batch", "lot", "expiry", "reorder", "adjustment", "reserved"],
  billing: ["billing", "subscription", "plan", "plans", "free", "pro", "enterprise", "premium", "invoice", "locked", "payment status", "locked feature", "feature locked", "upgrade", "downgrade", "current plan"],
  orders: ["order", "orders", "payment", "cod", "invoice", "dispatch", "delivery", "cancel", "history"],
  approval: ["registration", "register", "onboarding", "approval", "approve", "approved", "approvel", "pending", "reject", "rejected", "verify", "verification", "document", "gst", "status", "kab tak", "kitna time"],
  support: ["support", "help", "ticket", "issue", "admin", "agent", "talk to admin", "human", "contact", "email"],
};

// Category → FAQ section-name substrings (lowercase) that hold its answers.
const CATEGORY_SECTIONS = {
  dashboard: ["dashboard"],
  approval: ["registration", "company setup"],
  product: ["product"],
  inventory: ["inventory", "warehouse", "traceab"],
  orders: ["orders", "returns", "supply"],
  billing: ["billing"],
  support: ["users"],
};

// Category → preferred default question (used when the category matches but no
// specific question does — e.g. "free pro enterprise kya hai" → subscription plans).
const CATEGORY_REP = {
  dashboard: /module/i,
  approval: /approval status/i,
  product: /product kaise upload/i,
  inventory: /ims kya hai/i,
  orders: /orders kaha dikhte/i,
  billing: /subscription plans/i,
  support: /help kaise milegi/i,
};

const sectionIn = (section, subs) => subs.some((s) => section.toLowerCase().includes(s));

// ── Escalation: user wants a human / says the bot is wrong ───────────────────
const ESCALATION_PATTERNS = [
  "talk to admin", "speak to admin", "connect me to admin", "chat with admin",
  "contact admin", "need admin", "want admin", "admin se baat", "mujhe admin",
  "admin chahiye", "admin se baat karni",
  "human support", "human agent", "talk to human", "talk to a human",
  "real person", "real human", "representative", "customer care", "call me",
  "agent", "human",
  "ai answer galat", "ai galat", "answer galat", "galat answer", "wrong answer",
  "ai is wrong", "not helpful", "not satisfied", "manual check", "manually check",
];

// ── Greeting: ONLY a pure greeting message gets the welcome ──────────────────
const GREETING_WORDS = new Set(["hi", "hii", "hiii", "hello", "helo", "hlo", "hey", "heyy", "namaste", "hola", "help", "support", "start", "menu"]);
const GREETING_FILLER = new Set(["there", "sir", "team", "ji", "hai", "koi", "please", "thanks", "thank", "bro", "bhai"]);

// ── Personal CURRENT-STATUS: user asks about THEIR OWN approval/registration ─
const CURRENT_STATUS_PATTERNS = [
  "meri company approved", "meri company approve hui", "meri company approve ho",
  "meri company reject", "meri company rejected", "meri company ka status",
  "meri company ka approval", "meri approval status", "mera approval status",
  "mera registration status", "meri registration status", "mera status", "meri status",
  "meri approval request", "approval request ka update", "approval request ka status",
  "mera registration pending", "meri registration pending",
  "registration pending hai kya", "company approved hai kya", "company reject hui",
  "company rejected hai kya", "approved hai kya", "reject hui kya", "rejected hai kya",
  "pending hai kya", "approve hui kya", "approve ho gayi", "approval hui kya",
  "my approval status", "my company status", "my registration status", "my status",
  "is my company approved", "is my registration", "approval status kya",
  "mere account me", "mere account", "meri id", "sab modules mere",
];
const PERSONAL_MARKERS = ["meri", "mera", "mere", "apni", "apna", "my "];
const PERSONAL_STATUS_WORDS = ["status", "approved", "approval", "approve", "approvel", "pending", "reject", "rejected", "unlock", "account"];

// ── Dashboard/module ACCESS intent ("can I use all the options/modules") ─────
const ACCESS_DIRECT = [
  "sabhi option", "sab option", "sare option", "saare option", "sabhi options",
  "full dashboard", "poora dashboard", "dashboard me kya", "dashboard ke sab",
  "dashboard ke sabhi", "sabhi feature", "sab feature", "sabhi module", "sab module",
  "sare module", "option locked", "options locked", "feature unlock", "features unlock",
  "sabhi unlock", "sab unlock", "kya kya milega", "kya milega dashboard",
];
const ACCESS_PHRASES = [
  "use kar sakta", "use kar sakti", "use kar sakte", "use kar paunga", "use kar paungi",
  "kar sakta hu", "kar sakta hoon", "kar sakti hu", "use honge", "use hoga",
  "milega kya", "kya milega", "unlock hai", "unlock hoga", "access kar", "kab milega",
  "sab use", "sabhi use",
];
const ACCESS_NOUNS = [
  "option", "options", "module", "modules", "dashboard", "feature", "features",
  "sab", "sabhi", "sara", "saare", "access",
  "inventory", "product", "catalog", "order", "orders", "warehouse", "operation", "billing",
];

function detectEscalation(text) {
  const t = norm(text);
  return ESCALATION_PATTERNS.some((p) => t.includes(p));
}

// Whole message must be a greeting (+ optional filler) — "help" greets, but
// "order payment help" does not.
function detectGreeting(text) {
  const toks = wordsOf(text);
  if (!toks.length || toks.length > 3) return false;
  const hasGreeting = toks.some((t) => GREETING_WORDS.has(t));
  const allGreetingOrFiller = toks.every((t) => GREETING_WORDS.has(t) || GREETING_FILLER.has(t));
  return hasGreeting && allGreetingOrFiller;
}

function detectCurrentStatus(text) {
  const t = norm(text);
  if (CURRENT_STATUS_PATTERNS.some((p) => t.includes(p))) return true;
  const personal = PERSONAL_MARKERS.some((w) => t.includes(w));
  if (!personal) return false;
  return PERSONAL_STATUS_WORDS.some((w) => t.includes(w));
}

function detectAccessIntent(text) {
  const t = norm(text);
  if (ACCESS_DIRECT.some((p) => t.includes(p))) return true;
  const phrase = ACCESS_PHRASES.some((p) => t.includes(p));
  const noun = ACCESS_NOUNS.some((n) => t.includes(n));
  return phrase && noun;
}

// Score every intent category by its keyword list. Single words → token/fuzzy
// match; multi-word phrases → substring. Returns { cat, score } for the winner.
// Stricter than fuzzyEq for category keywords: exact, or (only for keywords ≥5
// chars) a shared prefix / edit-distance ≤1. Prevents short Hinglish glue words
// falsely matching (e.g. "hote" ~ "home").
function kwMatch(tok, kw) {
  if (tok === kw) return true;
  if (kw.length < 5) return false;
  if (tok.length >= 5 && (tok.startsWith(kw) || kw.startsWith(tok))) return true;
  return lev(tok, kw) <= 1;
}

function topCategory(text) {
  const t = norm(text);
  const toks = meaningful(wordsOf(text)); // drop stopwords so "hote/kya/hai" can't match
  let bestCat = null, bestScore = 0;
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    const singles = kws.filter((k) => !k.includes(" "));
    const phrases = kws.filter((k) => k.includes(" "));
    let s = 0;
    // Count each message token at most once per category (so "feature" doesn't
    // double-score against both "feature" and "features").
    for (const tok of toks) if (singles.some((k) => kwMatch(tok, k))) s += 1;
    for (const ph of phrases) if (t.includes(ph)) s += 2;
    if (s > bestScore) { bestScore = s; bestCat = cat; }
  }
  return { cat: bestCat, score: bestScore };
}

// The category's preferred/first FAQ answer (fallback when no specific question matches).
function repAnswer(cat) {
  const subs = CATEGORY_SECTIONS[cat] || [];
  const inCat = ENTRIES.filter((e) => sectionIn(e.section, subs));
  if (!inCat.length) return null;
  const rep = CATEGORY_REP[cat] && inCat.find((e) => CATEGORY_REP[cat].test(e.question));
  return (rep || inCat[0]).answer;
}

// Per-question relevance: 2 per fuzzy token hit on the question, +1 on a section
// word, +2 when both sides talk about time. `hits` counts the DISTINCT user
// tokens that landed on the QUESTION (not the section) — a confidence signal so a
// single coincidental fuzzy hit (e.g. "milega"~"milegi") can't answer on its own.
function questionScore(entry, uToks, uHasTime) {
  let s = 0, hits = 0;
  for (const ut of uToks) {
    if (entry.qTokens.some((qt) => fuzzyEq(ut, qt))) { s += 2; hits += 1; }
    else if (entry.sectionTokens.some((st) => fuzzyEq(ut, st))) s += 1;
  }
  if (uHasTime && entry.hasTime) s += 2;
  return { score: s, hits };
}

const bestOf = (entries, uToks, uHasTime) => {
  let best = null, bs = 0, bh = 0;
  for (const e of entries) {
    const { score, hits } = questionScore(e, uToks, uHasTime);
    if (score > bs) { bs = score; bh = hits; best = e; }
  }
  return { best, score: bs, hits: bh };
};

// Confidence threshold (req: score >= 0.45 → answer, else transfer). Confidence
// is normalised to 0..1 as the fraction of the user's meaningful tokens that the
// bot could actually explain (category intent + question overlap).
const CONFIDENCE_THRESHOLD = 0.45;
// A category is only "recognised" once its keyword score reaches this — one lone
// weak keyword is not enough intent to answer from a whole section.
const CATEGORY_MIN = 2;

// ── High-priority SPECIFIC intents ───────────────────────────────────────────
// Several registration questions share glue words (lagta/lagte/kitna), so a plain
// token scorer sends "kitne paise lagte he" (a COST question) to the "kitna time
// lagta hai" (TIME) answer. These rules read the real intent: each needs BOTH a
// context word (registration/account/…) AND a trigger word (paise/time/docs/…),
// and maps straight to ONE specific FAQ question. First matching rule wins, so
// order is priority — cost/free is checked before time so "paise" beats "kitne".
const REGISTRATION_CONTEXT = [
  "registration", "register", "registr", "ragistration", "ragister",
  "account", "banane", "banana", "banaye", "banau", "signup", "sign up",
  "onboarding", "khata", "join",
];
const SPECIFIC_INTENTS = [
  {
    name: "reg_pricing", // cost / charge / free → "Registration free hai kya?"
    context: REGISTRATION_CONTEXT,
    triggers: [
      "paise", "paisa", "paise", "paisay", "cost", "charge", "charges", "charg",
      "fee", "fees", "free", "price", "amount", "kharch", "kharcha", "rupay",
      "rupaye", "rupees", "rupee", "shulk", "muft", "paid", "kitne paise", "kitna paisa",
    ],
    target: /free hai kya/i,
  },
  {
    name: "reg_steps", // steps / process / flow → "Registration ke steps kya-kya hain?"
    context: [...REGISTRATION_CONTEXT, "onboarding"],
    triggers: [
      "step", "steps", "steps", "stage", "stages", "process", "proces", "procces",
      "procedure", "flow", "tarika", "tarike", "kitne step", "kitni step",
      "kitne steps", "kitni steps", "registration steps", "onboarding steps",
      "kaun kaun", "next step", "pehle kya",
    ],
    target: /steps kya-kya hain/i,
  },
  {
    name: "reg_documents", // documents / gst / pan → "…documents chahiye?"
    context: [...REGISTRATION_CONTEXT, "company"],
    triggers: [
      "document", "documents", "docs", "gst", "pan", "license", "licence",
      "kagaz", "kagzaat", "kaagaz", "dastavej", "dastavez", "papers", "proof",
    ],
    target: /documents chahiye/i,
  },
  {
    name: "reg_reject", // rejected / why → "Meri registration reject kyun hui?"
    context: REGISTRATION_CONTEXT,
    triggers: [
      "reject", "rejected", "rejection", "rejct", "kyun", "kyu", "kaaran",
      "karan", "declined", "namanjur", "mana",
    ],
    target: /reject kyun/i,
  },
  {
    name: "reg_time", // how long / when → "Registration approval me kitna time…"
    context: [...REGISTRATION_CONTEXT, "approval", "approve", "approved", "company"],
    triggers: [
      "time", "kab", "tak", "kitna time", "kitni der", "der", "ghante",
      "ghanta", "din", "days", "hours", "jaldi", "turant", "samay", "duration",
    ],
    target: /approval me kitna time/i,
  },
  {
    name: "reg_edit", // edit / change after submit → "…edit kar sakta hoon?"
    context: REGISTRATION_CONTEXT,
    triggers: [
      "edit", "change", "badal", "badalna", "badlna", "update", "modify",
      "sudhar", "sudhaar", "correction", "correct", "galti",
    ],
    target: /edit kar sakta/i,
  },
];

// True if any list item is present: multi-word items → substring on the normalised
// text; single words → fuzzy token match (tolerates spelling variants).
function listHit(uToks, tnorm, list) {
  for (const item of list) {
    if (item.includes(" ")) { if (tnorm.includes(item)) return true; }
    else if (uToks.some((tok) => fuzzyEq(tok, item))) return true;
  }
  return false;
}

// Resolve a message to a SPECIFIC FAQ answer via the intent rules above, or null.
function specificIntentMatch(uToks, tnorm) {
  for (const rule of SPECIFIC_INTENTS) {
    if (!listHit(uToks, tnorm, rule.context)) continue;
    if (!listHit(uToks, tnorm, rule.triggers)) continue;
    const entry = ENTRIES.find((e) => rule.target.test(e.question));
    if (entry) return { answer: entry.answer, intent: rule.name, confidence: 0.9 };
  }
  return null;
}

/**
 * Match a message to the best FAQ answer — STRICT, never guesses.
 *  1. Score intent categories from the keyword map (req: category/keyword match).
 *  2. Strong category (score >= CATEGORY_MIN) → search ONLY that category's FAQ
 *     section(s): a specific question wins, else the category's default answer
 *     (e.g. "free pro enterprise kya hai" → subscription plans).
 *  3. No strong category → global fuzzy question match, but require >= 2 DISTINCT
 *     question-token hits so a single coincidental fuzzy match can't answer.
 *  4. Confidence must reach CONFIDENCE_THRESHOLD; otherwise → null and the caller
 *     TRANSFERS to a human (req 5/6/7). No fallback/welcome/guess is returned.
 * Returns { answer, intent, confidence } or null.
 */
function matchFaq(text) {
  if (!ENTRIES.length) return null;
  const allToks = wordsOf(text);
  const uToks = meaningful(allToks);
  if (!uToks.length) return null; // nothing to match on → let caller transfer
  const uHasTime = allToks.some((t) => TIME_WORDS.has(t));
  const denom = uToks.length; // normalisation base for confidence

  // 0) Disambiguate shared-word registration questions (cost vs time vs docs …)
  //    before generic scoring can send a cost question to the time answer.
  const specific = specificIntentMatch(uToks, norm(text));
  if (specific) return specific;

  const top = topCategory(text);
  if (top.cat && top.score >= CATEGORY_MIN) {
    // Recognised intent → confident by construction. Pick the best specific
    // question in the section, else the category's representative answer.
    const subs = CATEGORY_SECTIONS[top.cat] || [];
    const inCat = ENTRIES.filter((e) => sectionIn(e.section, subs));
    const { best, hits } = bestOf(inCat, uToks, uHasTime);
    const confidence = Math.min(1, (top.score + hits) / (denom + 1));
    if (best && hits >= 1) return { answer: best.answer, intent: top.cat, confidence };
    const a = repAnswer(top.cat);
    if (a) return { answer: a, intent: top.cat, confidence: Math.max(confidence, CONFIDENCE_THRESHOLD) };
  }

  // No recognised category → require solid, multi-token question overlap.
  const { best, hits } = bestOf(ENTRIES, uToks, uHasTime);
  const confidence = Math.min(1, hits / denom);
  if (best && hits >= 2 && confidence >= CONFIDENCE_THRESHOLD) {
    return { answer: best.answer, intent: best.section, confidence };
  }
  return null;
}

/**
 * Build a CURRENT-STATUS answer from the company's REAL status — no time guess.
 * Returns { reply, escalate? }.
 */
function approvalReply(status, reason) {
  const s = norm(status);
  if (s === "approved") {
    return { reply: "Aapki company already approved hai. ✅ Aap apne dashboard ke sabhi modules use kar sakte hain." };
  }
  if (s === "rejected") {
    if (reason && String(reason).trim()) {
      return { reply: `Aapki company ka registration reject hua hai. Reason: ${String(reason).trim()}. Aap documents theek karke dobara submit kar sakte hain.` };
    }
    return {
      reply: "Aapki company ka registration reject hua hai. Rejection ka exact reason system me record nahi hai — main aapko admin support se connect kar raha hoon jo exact reason aur aage ke steps batayenge.",
      escalate: true,
    };
  }
  return {
    reply:
      "Aapki company abhi admin verification me hai (Pending). Exact approval time confirm nahi hai. Admin verification ke baad approval hota hai.\n\nAgar aap turant admin se baat karna chahte hain to \"Talk to Admin\" type karein.",
  };
}

/**
 * Evaluate a company message.
 *   → { needsCompany: true, intent: "current_status" }        personal status ask (DB).
 *   → { escalate: false, reply, intent, confidence }          confident FAQ/greeting answer.
 *   → { escalate: true, reason: "requested_human" }           user asked for a human.
 *   → { escalate: true, reason: "no_faq_match" }              out-of-FAQ / low confidence.
 * STRICT: no fallback/welcome/guess is ever returned for an unknown question —
 * anything the FAQ can't confidently answer is transferred to a human (req 5/6/7).
 */
function evaluate(text) {
  if (detectEscalation(text)) return { escalate: true, reason: "requested_human" };
  if (detectGreeting(text)) return { escalate: false, reply: GREETING, intent: "greeting" };
  if (detectCurrentStatus(text)) return { needsCompany: true, intent: "current_status" };
  const hit = matchFaq(text); // intent-keyword + fuzzy question matching
  if (hit) return { escalate: false, reply: hit.answer, intent: hit.intent, confidence: hit.confidence };
  return { escalate: true, reason: "no_faq_match" };
}

module.exports = {
  evaluate,
  approvalReply,
  // exposed for tests / diagnostics
  parseFaq,
  matchFaq,
  detectEscalation,
  detectGreeting,
  detectCurrentStatus,
  detectAccessIntent,
  _entryCount: ENTRIES.length,
};
