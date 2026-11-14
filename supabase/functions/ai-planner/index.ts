// Supabase Edge Function: ai-planner
// POST /functions/v1/ai-planner  { action: 'generate' | 'revise' | 'diary', tripId, ... }
//
// 호출 순서: 로그인 확인(JWT) → 여행 멤버 확인 → 입력 검증 → 사용량 제한 → 저장된 일정 조회
//   → 장소 후보(카카오, 선택) → OpenAI Responses API (JSON Schema 구조화 출력) → 결과 검증
//   → 장소 검증(카카오/OSM) → 초안(ai_drafts) 저장 → 미리보기 반환
// 실제 일정 반영은 앱이 사용자 승인 후 apply_ai_draft() RPC 로 해요 (이 함수는 일정을 직접 바꾸지 않음).
//
// 필요한 Secret: OPENAI_API_KEY (필수)
// 선택 Secret:  OPENAI_MODEL, OPENAI_REASONING_EFFORT, KAKAO_REST_API_KEY, AI_HOURLY_LIMIT, AI_DAILY_LIMIT,
//              AI_TIMEOUT_MS, ALLOWED_ORIGINS
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 Supabase가 자동으로 넣어 줘요.
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  buildGeneratePrompt, buildRevisePrompt, checkRange, GENERATE_SCHEMA, LIMITS, normalizeGenerated, normalizeRevise,
  REVISE_SCHEMA, SYSTEM_PROMPT, validateGenerateInput, validateReviseInput, ValidationError, annotateDistances, type CurrentItem,
} from '../_shared/plan-core.ts';
import { PlaceSearch, verifyItems } from '../_shared/places.ts';
import { buildDiaryPrompt, DIARY_SCHEMA, DIARY_SYSTEM_PROMPT, normalizeDiary, validateDiaryInput } from '../_shared/diary-core.ts';

const env = (k: string, d = '') => Deno.env.get(k) ?? d;
const MODEL = env('OPENAI_MODEL', 'gpt-5-mini');
const REASONING = env('OPENAI_REASONING_EFFORT', 'low'); // 추론 모델이 아니면 빈 값으로 설정
const HOURLY = Number(env('AI_HOURLY_LIMIT', '10'));
const DAILY = Number(env('AI_DAILY_LIMIT', '30'));
const TIMEOUT_MS = Number(env('AI_TIMEOUT_MS', '90000'));
// https://localhost = 안드로이드 앱(Capacitor), capacitor://localhost = 아이폰 앱
const ORIGINS = env('ALLOWED_ORIGINS', 'https://yunnoh1610.github.io,http://localhost:3700,https://localhost,capacitor://localhost').split(',').map((s) => s.trim()).filter(Boolean);

const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0] ?? '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

const json = (req: Request, status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' },
});

async function log(row: Record<string, unknown>) {
  await admin.from('ai_request_log').insert(row).then(() => {}, () => {});
}

// ---------- OpenAI Responses API ----------
interface AiResult { data: unknown; inputTokens: number | null; outputTokens: number | null }

async function callOpenAI(prompt: string, schemaName: string, schema: unknown, instructions = SYSTEM_PROMPT, maxTokens = 12000): Promise<AiResult> {
  const key = env('OPENAI_API_KEY');
  if (!key) throw new HttpError(503, 'AI_UNAVAILABLE', 'AI 기능이 아직 설정되지 않았어요 (서버 설정 필요)');
  const body: Record<string, unknown> = {
    model: MODEL,
    instructions,
    input: prompt,
    store: false,
    max_output_tokens: maxTokens,
    text: { format: { type: 'json_schema', name: schemaName, schema, strict: true } },
  };
  if (REASONING) body.reasoning = { effort: REASONING };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let r: Response;
  try {
    r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch (e) {
    throw (e as Error).name === 'AbortError'
      ? new HttpError(504, 'AI_UNAVAILABLE', 'AI 응답이 너무 늦어요. 잠시 후 다시 시도하거나 직접 일정을 추가해 주세요')
      : new HttpError(502, 'AI_UNAVAILABLE', 'AI 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요');
  } finally {
    clearTimeout(timer);
  }
  const res = await r.json().catch(() => null) as Record<string, any> | null;
  if (!r.ok || !res) {
    console.error('openai error', r.status, res?.error?.code, res?.error?.message);
    throw new HttpError(502, 'AI_UNAVAILABLE', r.status === 429
      ? 'AI 사용량이 많아 잠시 쉬어요. 조금 뒤 다시 시도해 주세요'
      : 'AI가 응답하지 못했어요. 잠시 후 다시 시도해 주세요');
  }
  if (res.status === 'incomplete') throw new HttpError(502, 'AI_UNAVAILABLE', '일정이 너무 길어서 AI가 끝까지 만들지 못했어요. 기간이나 요청을 줄여 주세요');
  let text = '';
  for (const o of res.output ?? []) {
    for (const c of o.content ?? []) {
      if (c.type === 'refusal') throw new HttpError(502, 'AI_UNAVAILABLE', 'AI가 이 요청은 도와줄 수 없다고 해요. 요청을 바꿔 주세요');
      if (c.type === 'output_text') text += c.text;
    }
  }
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new HttpError(502, 'AI_UNAVAILABLE', 'AI 결과를 읽지 못했어요. 다시 시도해 주세요'); }
  return { data, inputTokens: res.usage?.input_tokens ?? null, outputTokens: res.usage?.output_tokens ?? null };
}

// ---------- 공통 확인 ----------
async function authUser(req: Request) {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) throw new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요해요');
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요해요');
  return data.user;
}

async function loadTrip(tripId: number, userId: string) {
  // 클라이언트가 보낸 tripId 만 믿지 않고, 이 사용자가 실제 멤버인지 DB에서 확인
  // select('*'): 역할 칸(migrate-010) 전이어도 동작
  const { data: m } = await admin.from('trip_members').select('*').eq('trip_id', tripId).eq('user_id', userId).maybeSingle();
  if (!m) throw new HttpError(403, 'FORBIDDEN', '이 기록장에 접근할 수 없어요');
  if (m.role === 'VIEWER') throw new HttpError(403, 'FORBIDDEN', '보기 전용 멤버는 AI 기능을 쓸 수 없어요. 여행을 만든 사람에게 편집 권한을 부탁해 주세요');
  const { data: trip } = await admin.from('trips').select('id, title, start_date, end_date').eq('id', tripId).single();
  if (!trip) throw new HttpError(403, 'FORBIDDEN', '이 기록장에 접근할 수 없어요');
  const { data: plan } = await admin.from('trip_plans').select('revision, prefs').eq('trip_id', tripId).maybeSingle();
  return { trip, revision: plan?.revision ?? 0, prefs: (plan?.prefs ?? {}) as Record<string, unknown> };
}

async function rateLimit(userId: string) {
  const hourAgo = new Date(Date.now() - 3600e3).toISOString();
  const dayAgo = new Date(Date.now() - 86400e3).toISOString();
  const count = async (since: string) => (await admin.from('ai_request_log').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).gte('created_at', since).neq('status', 'rate_limited')).count ?? 0;
  if (await count(hourAgo) >= HOURLY || await count(dayAgo) >= DAILY) {
    throw new HttpError(429, 'RATE_LIMITED', 'AI 요청이 너무 많아요. 잠시 후 다시 시도해 주세요');
  }
}

// ---------- 일정 만들기 ----------
async function generate(body: Record<string, unknown>, userId: string) {
  const input = validateGenerateInput(body);
  const { trip, revision } = await loadTrip(input.tripId, userId);
  const range = checkRange(trip.start_date, trip.end_date);
  await rateLimit(userId);

  const search = new PlaceSearch(env('KAKAO_REST_API_KEY') || null, 12);
  const center = await search.locate(input.destination);
  const candidates = center ? await search.kakaoCandidates(center) : [];
  const ai = await callOpenAI(buildGeneratePrompt(input, range, candidates), 'itinerary', GENERATE_SCHEMA);
  const result = normalizeGenerated(ai.data, range);
  const items = result.days.flatMap((d) => d.items);
  const v = await verifyItems(items, search, center);
  if (v.skipped) result.warnings.unshift(`장소 ${v.skipped}곳은 확인하지 못했어요 (미확인으로 표시)`);
  if (!center) result.warnings.unshift(`'${input.destination}' 위치를 찾지 못해 장소 확인이 정확하지 않을 수 있어요`);

  const { data: draft, error } = await admin.from('ai_drafts').insert({
    trip_id: input.tripId, created_by: userId, kind: 'GENERATE',
    request_json: { ...input, startDate: range.start, endDate: range.end },
    result_json: result, base_revision: revision,
  }).select('id').single();
  if (error) throw new HttpError(500, 'INTERNAL', '초안을 저장하지 못했어요');
  return {
    ai,
    response: { draftId: draft.id, status: 'DRAFT', baseRevision: revision, days: result.days, warnings: result.warnings, model: MODEL, verified: v.verified },
  };
}

// ---------- 일정 부분 수정 ----------
async function revise(body: Record<string, unknown>, userId: string) {
  const tripId = Number(body.tripId);
  if (!Number.isSafeInteger(tripId)) throw new ValidationError(['여행 정보가 올바르지 않아요']);
  const { trip, revision, prefs } = await loadTrip(tripId, userId);
  const range = checkRange(trip.start_date, trip.end_date);
  const input = validateReviseInput(body, range);
  if (input.baseRevision !== revision) {
    throw new HttpError(409, 'REVISION_CONFLICT', '그 사이 일정이 바뀌었어요. 새로고침 후 다시 요청해 주세요');
  }
  await rateLimit(userId);

  let qb = admin.from('itinerary_items')
    .select('id, day_date, item_type, title, start_time, end_time, place_name, address, lat, lng, verification_status, cost_estimate, currency, notes, source, user_edited')
    .eq('trip_id', tripId).order('day_date').order('sort_order');
  if (input.targetDay) qb = qb.eq('day_date', input.targetDay);
  const { data: items, error } = await qb.limit(LIMITS.maxReviseScope);
  if (error) throw new HttpError(500, 'INTERNAL', '일정을 불러오지 못했어요');

  const destination = typeof prefs.destination === 'string' ? prefs.destination : null;
  const ai = await callOpenAI(buildRevisePrompt(input, range, items as CurrentItem[], {
    destination,
    transport: typeof prefs.transport === 'string' ? prefs.transport : undefined,
    styles: Array.isArray(prefs.styles) ? prefs.styles as string[] : [],
    travelerCount: typeof prefs.travelerCount === 'number' ? prefs.travelerCount : undefined,
  }), 'itinerary_revision', REVISE_SCHEMA);
  const result = normalizeRevise(ai.data, items as CurrentItem[], range, input.targetDay, input.mode);

  const search = new PlaceSearch(env('KAKAO_REST_API_KEY') || null, 8);
  const center = destination ? await search.locate(destination) : null;
  await verifyItems(result.operations.flatMap((o) => (o.item ? [o.item] : [])), search, center);
  if (input.mode === 'ADD') result.warnings.unshift(...annotateDistances(result.operations, items as CurrentItem[]));

  const { data: draft, error: e2 } = await admin.from('ai_drafts').insert({
    trip_id: tripId, created_by: userId, kind: 'REVISE',
    request_json: { targetDay: input.targetDay, instruction: input.instruction, mode: input.mode },
    result_json: result, base_revision: revision,
  }).select('id').single();
  if (e2) throw new HttpError(500, 'INTERNAL', '초안을 저장하지 못했어요');
  return {
    ai,
    response: { draftId: draft.id, status: 'DRAFT', baseRevision: revision, operations: result.operations, warnings: result.warnings, model: MODEL },
  };
}

// ---------- 여행 일기 초안 (저장하지 않고 돌려주기만, 앱에서 확인 후 반영) ----------
async function diary(body: Record<string, unknown>, userId: string) {
  const input = validateDiaryInput(body);
  const { trip } = await loadTrip(input.tripId, userId);
  await rateLimit(userId);
  const ai = await callOpenAI(buildDiaryPrompt(input, trip.title), 'diary', DIARY_SCHEMA, DIARY_SYSTEM_PROMPT, 4000);
  const result = normalizeDiary(ai.data);
  return { ai, response: { ...result, model: MODEL } };
}

// ---------- 진입점 ----------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  const requestId = crypto.randomUUID();
  const fail = (status: number, code: string, message: string) => json(req, status, { error: { code, message, requestId } });
  if (req.method !== 'POST') return fail(405, 'VALIDATION_ERROR', 'POST 로 요청해 주세요');

  let userId: string | null = null;
  let tripId: number | null = null;
  let feature = 'unknown';
  try {
    const raw = await req.text();
    if (raw.length > 16000) throw new ValidationError(['요청이 너무 길어요']);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { throw new ValidationError(['요청 형식이 올바르지 않아요']); }
    if (!body || typeof body !== 'object') throw new ValidationError(['요청 형식이 올바르지 않아요']);
    feature = String(body.action);
    userId = (await authUser(req)).id;
    tripId = Number.isSafeInteger(Number(body.tripId)) ? Number(body.tripId) : null;

    let out;
    if (feature === 'generate') out = await generate(body, userId);
    else if (feature === 'revise') out = await revise(body, userId);
    else if (feature === 'diary') out = await diary(body, userId);
    else throw new ValidationError(['알 수 없는 요청이에요']);

    await log({ user_id: userId, trip_id: tripId, feature, status: 'ok', model: MODEL, input_tokens: out.ai.inputTokens, output_tokens: out.ai.outputTokens });
    return json(req, 200, { ...out.response, requestId });
  } catch (e) {
    let status = 500;
    let code = 'INTERNAL';
    let message = '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요';
    if (e instanceof ValidationError) { status = 400; code = 'VALIDATION_ERROR'; message = e.message; }
    else if (e instanceof HttpError) { status = e.status; code = e.code; message = e.message; }
    else console.error(requestId, e);
    // 실패도 기록 (요청 내용은 저장하지 않음). 로그인 안 된 요청은 기록하지 않음
    if (userId && code !== 'FORBIDDEN') {
      await log({ user_id: userId, trip_id: tripId, feature, status: code === 'RATE_LIMITED' ? 'rate_limited' : 'error', model: MODEL, error_code: code });
    }
    return fail(status, code, message);
  }
});
