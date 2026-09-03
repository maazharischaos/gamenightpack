// Cloudflare Pages Function: generates quiz questions with active Gemini 3.x fallback models.
// Reachable at /api/questions

const GEMINI_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.7-flash'
];

function buildPrompt({ topic, categories, count, avoid }) {
  let subject = '';
  if (topic && String(topic).trim()) {
    subject = `the topic "${String(topic).trim()}"`;
  } else if (Array.isArray(categories) && categories.length > 0) {
    subject = `these categories: ${categories.join(', ')}`;
  } else {
    subject = 'General Knowledge trivia';
  }

  const avoidLine = (avoid && avoid.length)
    ? `\nDo NOT repeat or rephrase any of these questions:\n- ${avoid.slice(0, 40).join('\n- ')}\n`
    : '';

  return `System: You are an ultra-fast, JSON-only trivia generator. Return ONLY a valid JSON array of questions without markdown formatting.

User: Write exactly ${count} DISTINCT multiple-choice trivia questions about ${subject}.${avoidLine}

Hard Rules:
- Return ONLY a raw JSON array.
- Each object must have:
  "q": string (question text, <110 chars)
  "a": string (exact correct answer text, <40 chars)
  "opts": array of 4 string options (including "a")
  "cat": short string category label
- The 3 wrong options must be of the exact same category/type as the correct answer.
- The correct answer "a" MUST appear verbatim in "opts".`;
}

function extractJSON(text) {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
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

async function callSingleModel(model, key, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
      responseMimeType: "application/json"
    }
  };

  // No fetch timeout abort signal so the worker waits as long as needed for Gemini to return
  const res = await fetch(url, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-goog-api-key': key
    },
    body: JSON.stringify(payload)
  });

  const raw = await res.text();
  if (!res.ok) throw new Error(`Google API [${model}] ${res.status}: ${raw.slice(0, 150)}`);

  const data = JSON.parse(raw);
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  const parsed = extractJSON(text);
  if (!parsed) throw new Error(`Unparseable output from model ${model}`);
  return { parsed, usedModel: model };
}

async function callGeminiWithFallback(key, prompt) {
  let lastErr = null;
  for (const model of GEMINI_MODELS) {
    try {
      return await callSingleModel(model, key, prompt);
    } catch (err) {
      lastErr = err;
      continue;
    }
  }
  throw lastErr || new Error('All Gemini fallback models failed.');
}

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });
  if (context.request.method === 'GET') return new Response(JSON.stringify({ ok: true, models: GEMINI_MODELS }), { status: 200, headers: CORS });
  if (context.request.method !== 'POST') return new Response(JSON.stringify({ error: 'Use POST' }), { status: 405, headers: CORS });

  const geminiKey = context.env?.GEMINI_API_KEY;
  if (!geminiKey) return new Response(JSON.stringify({ error: 'GEMINI_API_KEY environment variable is missing in Cloudflare Pages.' }), { status: 500, headers: CORS });

  let body = {};
  try { body = await context.request.json(); } catch (_) {}
  const count = Math.min(30, Math.max(1, parseInt(body.count, 10) || 20));
  const avoid = Array.isArray(body.avoid) ? body.avoid : [];
  const prompt = buildPrompt({ topic: body.topic, categories: body.categories, count, avoid });

  try {
    const { parsed, usedModel } = await callGeminiWithFallback(geminiKey, prompt);
    const questions = clean(parsed, count, new Set(avoid.map(a => String(a).toLowerCase())));
    if (questions.length >= 1) {
      return new Response(JSON.stringify({ questions, provider: usedModel, asked: count, got: questions.length }), { status: 200, headers: CORS });
    }
    return new Response(JSON.stringify({ error: 'No valid questions returned from AI' }), { status: 500, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}