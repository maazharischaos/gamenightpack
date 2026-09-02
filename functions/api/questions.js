// Cloudflare Pages Function: generates quiz questions strictly via Gemini 3.6 Flash.
// Lives at functions/api/questions.js and is reachable at /api/questions
//
// Requires environment variable: GEMINI_API_KEY
// Set under: Cloudflare Pages > your project > Settings > Environment variables

const GEMINI_MODEL = 'gemini-3.6-flash';

function buildPrompt({ topic, categories, count, avoid }) {
  const subject = topic
    ? `the topic "${topic}"`
    : `these categories: ${(categories || []).join(', ')}`;
  const avoidLine = (avoid && avoid.length)
    ? `\nDo NOT repeat or rephrase any of these already-used questions:\n- ${avoid.slice(0, 60).join('\n- ')}\n`
    : '';
  return `You are writing questions for a live pub-quiz app.

Write exactly ${count} DISTINCT multiple-choice trivia questions about ${subject}.
${avoidLine}
Hard rules:
- All ${count} questions must be different from each other — no two testing the same fact, no rephrasings.
- Every question has exactly ONE unambiguously correct, well-established answer.
- Provide 4 options. The 3 wrong options must be the SAME KIND of thing as the correct answer
  (answer is a woman's name -> all options women's names; a football club -> all clubs; a year -> all years).
- Wrong options must be clearly wrong to someone who knows the subject, never secretly also correct.
- Each question under 110 characters, each option under 40 characters.

Return ONLY a JSON array, no markdown, no commentary, in exactly this shape:
[{"q":"question text","a":"correct answer","opts":["correct answer","wrong1","wrong2","wrong3"],"cat":"short label"}]
The "a" value must appear verbatim in "opts".`;
}

function extractJSON(text) {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const s = t.indexOf('['), e = t.lastIndexOf(']');
  if (s === -1 || e === -1 || e <= s) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch (_) { return null; }
}

function clean(list, count, seenKeys) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = seenKeys || new Set();
  for (const item of list) {
    if (!item || typeof item.q !== 'string' || typeof item.a !== 'string') continue;
    let opts = Array.isArray(item.opts) ? [...new Set(item.opts.filter(o => typeof o === 'string'))] : [];
    if (!opts.includes(item.a)) opts.unshift(item.a);
    if (opts.length < 4) continue;
    opts = opts.slice(0, 4);
    if (!opts.includes(item.a)) continue;
    const key = item.q.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      q: item.q.trim(),
      a: item.a.trim(),
      opts,
      cat: (typeof item.cat === 'string' && item.cat.trim()) ? item.cat.trim().slice(0, 24) : 'AI'
    });
    if (out.length >= count) break;
  }
  return out;
}

async function callGemini36(key, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9, maxOutputTokens: 8192, responseMimeType: 'application/json' }
    })
  });
  
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini 3.6 API HTTP ${res.status}: ${raw.slice(0, 200)}`);
  }
  
  const data = JSON.parse(raw);
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  const parsed = extractJSON(text);
  if (!parsed) {
    throw new Error('Unparseable output from Gemini 3.6');
  }
  return parsed;
}

// Cloudflare Pages Functions entry points ----------------------------------

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export async function onRequest(context) {
  const method = context.request.method;
  if (method === 'OPTIONS') {
    return new Response('', { status: 204, headers: CORS });
  }
  if (method === 'GET') {
    return new Response(JSON.stringify({ ok: true, model: GEMINI_MODEL, message: 'Function live. Send POST requests to generate questions.' }), { status: 200, headers: CORS });
  }
  if (method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Use POST' }), { status: 405, headers: CORS });
  }

  const env = context.env || {};
  const geminiKey = env.GEMINI_API_KEY;

  if (!geminiKey) {
    return new Response(JSON.stringify({
      error: 'GEMINI_API_KEY environment variable is missing.'
    }), { status: 500, headers: CORS });
  }

  let body = {};
  try { body = await context.request.json(); } catch (_) {}
  const count = Math.min(30, Math.max(1, parseInt(body.count, 10) || 20));
  const avoid = Array.isArray(body.avoid) ? body.avoid : [];
  const prompt = buildPrompt({ topic: body.topic, categories: body.categories, count, avoid });

  try {
    const parsed = await callGemini36(geminiKey, prompt);
    const questions = clean(parsed, count, new Set(avoid.map(a => String(a).toLowerCase())));
    if (questions.length >= 1) {
      return new Response(JSON.stringify({ questions, provider: 'gemini-3.6-flash', asked: count, got: questions.length }), { status: 200, headers: CORS });
    }
    return new Response(JSON.stringify({ error: 'No usable questions returned', provider: 'gemini-3.6-flash' }), { status: 502, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, provider: 'gemini-3.6-flash' }), { status: 502, headers: CORS });
  }
}