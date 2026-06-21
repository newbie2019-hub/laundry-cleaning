import { format } from 'date-fns'
import type { AssistantIntent } from '../types'
import type { AiProvider } from '../../../lib/assistant-settings'
import { parseLocal } from './local-parser'

const TIMEOUT_MS = 12_000

function today() {
  return format(new Date(), 'yyyy-MM-dd')
}

function buildSystemPrompt(): string {
  return `You are an intent parser for a Filipino small-business app. Today is ${today()}.

Extract the user's intent and return ONLY a JSON object matching this schema:

For QUERY intents:
{
  "kind": "query",
  "category": "sales" | "expense" | "customer" | "inventory" | "staff" | "payroll",
  "subtype": string,
  "dateRange": { "from": "yyyy-MM-dd", "to": "yyyy-MM-dd" } | null,
  "customerName": string | null,
  "staffName": string | null,
  "itemName": string | null,
  "categoryName": string | null
}

Sales subtypes: total | by_customer | by_item | top_selling | recent | average_daily
Expense subtypes: total | by_category | operating | largest | recent
Customer subtypes: recent | top | frequent | purchase_history | list
Inventory subtypes: low_stock | current_stock | fast_moving | most_sold | movement_history | list
Staff subtypes: present | absent | attendance_summary | daily_rate | list
Payroll subtypes: summary | by_employee | overtime | deductions | history

For CREATE intents:
{
  "kind": "create",
  "entity": "customer" | "inventory" | "sale" | "expense" | "staff" | "attendance",
  "fields": { ...entity-specific fields }
}

Customer fields: name, phone, email, company
Inventory fields: name, category, unitType, unitLabel, costPerUnit (number|null), sellingPrice (number|null), initialStock (number|null), lowStockThreshold (number|null), supplier, description
Sale fields: customerName, items ([{itemName, quantity}]), amount (number|null), date (yyyy-MM-dd|null), description, categoryName
Expense fields: amount (number|null), categoryName, description, date (yyyy-MM-dd|null)
Staff fields: firstName, middleName, lastName, defaultRate (number|null), civilStatus, birthdate (yyyy-MM-dd or ""), address, emergencyContactName, emergencyContactNumber
Attendance fields: staffName, date (yyyy-MM-dd|null), status ("present"|"absent"|"half"|"overtime"|"holiday"), multiplier (number|null), rateOverride (number|null), notes

For unknown: { "kind": "unknown", "raw": "..." }

Rules:
- Resolve relative dates: today=${today()}, yesterday=day before
- Amounts may be in ₱ or "pesos" - return as number without currency symbol
- Dates must be yyyy-MM-dd format or null
- Return ONLY valid JSON, no markdown fences, no explanation
`
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    return res
  } finally {
    clearTimeout(timer)
  }
}

function extractJson(text: string): string {
  // Strip markdown code fences if present
  const fenced = /```(?:json)?\s*([\s\S]+?)```/.exec(text)
  if (fenced) return fenced[1].trim()
  // Find first { ... }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end !== -1) return text.slice(start, end + 1)
  return text
}

// ─── Claude ───────────────────────────────────────────────────────────────────

async function parseClaude(text: string, apiKey: string, model: string): Promise<AssistantIntent> {
  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: text }],
    }),
  })
  if (!res.ok) {
    let detail = ''
    try { detail = `: ${JSON.stringify(await res.json())}` } catch { /* ignore */ }
    throw new Error(`Claude API error ${res.status}${detail}`)
  }
  const data = (await res.json()) as { content: Array<{ text: string }> }
  const raw = data.content?.[0]?.text ?? ''
  return JSON.parse(extractJson(raw)) as AssistantIntent
}

// ─── OpenAI / GPT ─────────────────────────────────────────────────────────────

async function parseGpt(text: string, apiKey: string, model: string): Promise<AssistantIntent> {
  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: text },
      ],
    }),
  })
  if (!res.ok) {
    let detail = ''
    try { detail = `: ${JSON.stringify(await res.json())}` } catch { /* ignore */ }
    throw new Error(`OpenAI API error ${res.status}${detail}`)
  }
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> }
  const raw = data.choices?.[0]?.message?.content ?? ''
  return JSON.parse(extractJson(raw)) as AssistantIntent
}

// ─── Gemini ───────────────────────────────────────────────────────────────────

async function parseGemini(text: string, apiKey: string, model: string): Promise<AssistantIntent> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { maxOutputTokens: 512 },
    }),
  })
  if (!res.ok) {
    let detail = ''
    try { detail = `: ${JSON.stringify(await res.json())}` } catch { /* ignore */ }
    throw new Error(`Gemini API error ${res.status}${detail}`)
  }
  const data = (await res.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  return JSON.parse(extractJson(raw)) as AssistantIntent
}

// ─── Public API ───────────────────────────────────────────────────────────────

type CloudParseOptions = {
  provider: Exclude<AiProvider, 'auto'>
  apiKey: string
  model: string
}

/**
 * Call the cloud provider. Falls back to local parser on any error.
 * Returns { intent, usedCloud } so the caller can show which parser ran.
 */
export async function parseCloud(
  text: string,
  opts: CloudParseOptions,
): Promise<{ intent: AssistantIntent; usedCloud: boolean }> {
  try {
    let intent: AssistantIntent
    if (opts.provider === 'claude') {
      intent = await parseClaude(text, opts.apiKey, opts.model)
    } else if (opts.provider === 'gpt') {
      intent = await parseGpt(text, opts.apiKey, opts.model)
    } else {
      intent = await parseGemini(text, opts.apiKey, opts.model)
    }
    return { intent, usedCloud: true }
  } catch (err) {
    console.warn('[cloud-parser] Falling back to local parser:', err)
    return { intent: parseLocal(text), usedCloud: false }
  }
}

/**
 * Test that a given API key can reach its provider.
 * Returns null on success, or an error message.
 */
export async function testApiKey(opts: CloudParseOptions): Promise<string | null> {
  try {
    const testText = 'What were my sales today?'
    if (opts.provider === 'claude') {
      await parseClaude(testText, opts.apiKey, opts.model)
    } else if (opts.provider === 'gpt') {
      await parseGpt(testText, opts.apiKey, opts.model)
    } else {
      await parseGemini(testText, opts.apiKey, opts.model)
    }
    return null
  } catch (err) {
    return err instanceof Error ? err.message : 'Connection failed'
  }
}
