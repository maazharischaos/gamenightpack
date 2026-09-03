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
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();