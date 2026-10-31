// RouterMate AI backend (Cloudflare Worker, free plan is enough).
// The Gemini key and the app token live only here, as Worker secrets. They are never in the APK.
//   GEMINI_API_KEY  secret  your Google AI Studio key
//   APP_TOKEN       secret  a long random password; the app sends it in "Authorization: Bearer ..."
//   GEMINI_MODEL    var     optional, default below
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const FALLBACKS = ["gemini-3.6-flash", "gemini-3.8-flash"];
const MAX_BODY = 60_000;      // bytes
const MAX_TURNS = 40;         // contents entries per request

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function safeEqual(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}

export default {
  async fetch(req, env) {
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    if (!env.APP_TOKEN || !env.GEMINI_API_KEY) return json({ error: "Backend is not configured (missing secrets)" }, 500);
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ") || !safeEqual(auth.slice(7).trim(), String(env.APP_TOKEN).trim())) return json({ error: "Unauthorized" }, 401);

    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ error: "Request too large" }, 413);
    let b; try { b = JSON.parse(raw); } catch { return json({ error: "Bad JSON" }, 400); }
    if (!Array.isArray(b.contents) || b.contents.length === 0 || b.contents.length > MAX_TURNS) return json({ error: "Bad contents" }, 400);

    // Forward only the fields we expect; the model and key are chosen here, not by the app.
    const payload = {
      systemInstruction: b.systemInstruction,
      contents: b.contents,
      tools: Array.isArray(b.tools) ? b.tools.slice(0, 1) : undefined,
      generationConfig: { temperature: 0.3, maxOutputTokens: 900 },
    };
    // Try the preferred model first; if Google says it is busy/unavailable or it is slow, fall back to the next.
    const models = [...new Set([env.GEMINI_MODEL || DEFAULT_MODEL, ...FALLBACKS])];
    let last = { status: 503, text: JSON.stringify({ error: { message: "No model answered" } }) };
    for (const model of models) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
        });
        const text = await r.text();
        if (r.ok) return new Response(text, { status: 200, headers: { "Content-Type": "application/json", "X-Model": model } });
        last = { status: r.status, text };
        if (![429, 500, 503, 504, 404].includes(r.status)) break;   // real errors (bad key, bad request) will not improve by switching
      } catch (e) {
        last = { status: 504, text: JSON.stringify({ error: { message: `${model} timed out` } }) };
      }
    }
    return new Response(last.text, { status: last.status === 429 ? 429 : 502, headers: { "Content-Type": "application/json" } });
  },
};
