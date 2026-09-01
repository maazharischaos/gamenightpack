// Cloudflare Pages Function: generates quiz questions.
// Lives at  functions/api/questions.js  and is reachable at  /api/questions
//
// Supports TWO providers — choose with the PROVIDER env var: "openai" or "gemini".
//   PROVIDER=openai   + OPENAI_API_KEY=sk-...      (paid, pay-as-you-go)
//   PROVIDER=gemini   + GEMINI_API_KEY=...         (free tier)
// If PROVIDER is unset, it uses whichever key is present (OpenAI first).
//
// Set these under: Cloudflare Pages > your project > Settings > Environment variables

// Flash-Lite first: higher requests-per-minute on the free tier, and faster.
const GEMINI_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.0-flash'
];
const OPENAI_MODEL = 'gpt-4o-mini';

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
      q: item.q.trim(), a: item.a.trim(), opts,
      cat: (typeof item.cat === 'string' && item.cat.trim()) ? item.cat.trim().slice(0, 24) : 'AI'
    });
    if (out.length >= count) break;
  }
  return out;
}

async function callOpenAI(key, prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: 'You output only valid JSON. No prose, no markdown.' },
        { role: 'user', content: prompt + '\n\nReturn a JSON object of the form {"questions": [ ... ]}.' }
      ],
      temperature: 0.9,
      max_tokens: 4096,
      response_format: { type: 'json_object' }
    })
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${raw.slice(0, 200)}`);
  const data = JSON.parse(raw);
  let content = data?.choices?.[0]?.message?.content || '';
  try {
    const o = JSON.parse(content);
    if (Array.isArray(o)) return o;
    return o.questions || o.items || o.data || Object.values(o).find(Array.isArray) || null;
  } catch (_) {
    return extractJSON(content);
  }
}

async function callGemini(key, prompt) {
  const errors = [];
  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.9, maxOutputTokens: 8192, responseMimeType: 'application/json' }
        })
      });
      const raw = await res.text();
      if (res.status === 429) { errors.push(`${model}: rate-limited`); continue; }
      if (!res.ok) { errors.push(`${model}: HTTP ${res.status}`); continue; }
      const data = JSON.parse(raw);
      const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
      const parsed = extractJSON(text);
      if (parsed) return parsed;
      errors.push(`${model}: unparseable`);
    } catch (e) { errors.push(`${model}: ${e.message}`); }
  }
  throw new Error('Gemini failed: ' + errors.join(' | '));
}

// Cloudflare Pages Functions entry points ----------------------------------

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// Single entry point for ALL methods — avoids any per-method routing mismatch
// (which was showing up as a 405). We branch on the method ourselves.
export async function onRequest(context) {
  const method = context.request.method;
  if (method === 'OPTIONS') {
    return new Response('', { status: 204, headers: CORS });
  }
  if (method === 'GET') {
    // A browser visit / liveness check. 200 so the test button reads it as "reachable".
    return new Response(JSON.stringify({ ok: true, message: 'Function live. Use POST to generate.' }), { status: 200, headers: CORS });
  }
  if (method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Use POST' }), { status: 405, headers: CORS });
  }

  const env = context.env || {};
  const openaiKey = env.OPENAI_API_KEY;
  const geminiKey = env.GEMINI_API_KEY;
  let provider = (env.PROVIDER || '').toLowerCase();
  if (!provider) provider = openaiKey ? 'openai' : 'gemini';

  const key = provider === 'openai' ? openaiKey : geminiKey;
  if (!key) {
    return new Response(JSON.stringify({
      error: `No API key for provider "${provider}". Set ${provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'} in Cloudflare Pages environment variables.`
    }), { status: 500, headers: CORS });
  }

  let body = {};
  try { body = await context.request.json(); } catch (_) {}
  const count = Math.min(30, Math.max(1, parseInt(body.count, 10) || 20));
  const avoid = Array.isArray(body.avoid) ? body.avoid : [];
  const prompt = buildPrompt({ topic: body.topic, categories: body.categories, count, avoid });

  try {
    const parsed = provider === 'openai'
      ? await callOpenAI(key, prompt)
      : await callGemini(key, prompt);
    const questions = clean(parsed, count, new Set(avoid.map(a => String(a).toLowerCase())));
    if (questions.length >= 1) {
      return new Response(JSON.stringify({ questions, provider, asked: count, got: questions.length }), { status: 200, headers: CORS });
    }
    return new Response(JSON.stringify({ error: 'No usable questions returned', provider }), { status: 502, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, provider }), { status: 502, headers: CORS });
  }
}
