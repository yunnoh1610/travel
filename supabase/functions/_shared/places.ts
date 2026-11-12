// 장소 검증: AI가 고른 장소 이름을 실제 장소 검색 결과와 맞춰 봐요.
// - KAKAO_REST_API_KEY(Supabase Secret)가 있으면 카카오 로컬 검색 (한국 장소에 정확)
// - 없거나 결과가 없으면 OpenStreetMap Nominatim (1초에 1번 규칙을 지키려고 개수 제한)
// 맞는 장소를 찾으면 VERIFIED + 좌표, 못 찾으면 UNVERIFIED (확정 정보처럼 보이지 않게)
import { pickMatch, PLACE_TYPES, type DraftItem, type PlaceHit } from './plan-core.ts';

type Item = Omit<DraftItem, 'temporaryId'>;
interface Center { lat: number; lng: number }

const UA = 'travel-diary-planner/1.0 (Supabase Edge Function)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url: string, init: RequestInit, timeoutMs = 6000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export class PlaceSearch {
  kakaoKey: string | null;
  nominatimBudget: number;
  lastNominatim = 0;

  constructor(kakaoKey: string | null, nominatimBudget = 10) {
    this.kakaoKey = kakaoKey;
    this.nominatimBudget = nominatimBudget;
  }

  async kakao(query: string, center: Center | null, radiusM = 20000): Promise<PlaceHit[]> {
    if (!this.kakaoKey) return [];
    const p = new URLSearchParams({ query, size: '5' });
    if (center) { p.set('x', String(center.lng)); p.set('y', String(center.lat)); p.set('radius', String(radiusM)); }
    const j = await fetchJson(`https://dapi.kakao.com/v2/local/search/keyword.json?${p}`, {
      headers: { Authorization: `KakaoAK ${this.kakaoKey}` },
    }) as { documents?: Record<string, string>[] } | null;
    return (j?.documents ?? []).map((d) => ({
      name: d.place_name, address: d.road_address_name || d.address_name || null,
      lat: Number(d.y), lng: Number(d.x), id: d.id ? `kakao:${d.id}` : null,
    }));
  }

  /** 카카오 카테고리 검색으로 여행지 주변 후보 이름 (AI에게 주는 장소 후보) */
  async kakaoCandidates(center: Center): Promise<string[]> {
    if (!this.kakaoKey) return [];
    const codes = ['AT4', 'CT1', 'FD6', 'CE7']; // 관광명소, 문화시설, 음식점, 카페
    const lists = await Promise.all(codes.map(async (code) => {
      const p = new URLSearchParams({ category_group_code: code, x: String(center.lng), y: String(center.lat), radius: '15000', size: '10', sort: 'accuracy' });
      const j = await fetchJson(`https://dapi.kakao.com/v2/local/search/category.json?${p}`, {
        headers: { Authorization: `KakaoAK ${this.kakaoKey}` },
      }) as { documents?: Record<string, string>[] } | null;
      return (j?.documents ?? []).map((d) => `${d.place_name} (${(d.category_name || '').split('>').pop()?.trim() || code})`);
    }));
    return [...new Set(lists.flat())];
  }

  async nominatim(query: string, center: Center | null): Promise<PlaceHit[]> {
    if (this.nominatimBudget <= 0) return [];
    this.nominatimBudget--;
    const wait = this.lastNominatim + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastNominatim = Date.now();
    const p = new URLSearchParams({ q: query, format: 'jsonv2', limit: '5', 'accept-language': 'ko' });
    if (center) {
      p.set('viewbox', `${center.lng - 0.6},${center.lat + 0.5},${center.lng + 0.6},${center.lat - 0.5}`);
      p.set('bounded', '1');
    }
    const j = await fetchJson(`https://nominatim.openstreetmap.org/search?${p}`, { headers: { 'User-Agent': UA } }) as Record<string, string>[] | null;
    return (j ?? []).map((x) => ({
      name: String(x.name || String(x.display_name || '').split(',')[0]).split(';')[0].trim(),
      address: x.display_name || null, lat: Number(x.lat), lng: Number(x.lon),
      id: x.osm_type && x.osm_id ? `osm:${x.osm_type}/${x.osm_id}` : null,
    }));
  }

  /** 여행지(도시·지역) 중심 좌표 */
  async locate(destination: string): Promise<Center | null> {
    const k = await this.kakao(destination, null);
    if (k[0]) return { lat: k[0].lat, lng: k[0].lng };
    const n = await this.nominatim(destination, null);
    return n[0] ? { lat: n[0].lat, lng: n[0].lng } : null;
  }

  async find(query: string, center: Center | null): Promise<PlaceHit | null> {
    const k = await this.kakao(query, center);
    const hit = pickMatch(query, k, center);
    if (hit) return hit;
    return pickMatch(query, await this.nominatim(query, center), center);
  }
}

/** 장소형 일정을 검색해 검증 상태와 좌표를 채움. 같은 이름은 한 번만 검색 */
export async function verifyItems(items: Item[], search: PlaceSearch, center: Center | null): Promise<{ checked: number; verified: number; skipped: number }> {
  const cache = new Map<string, PlaceHit | null>();
  let checked = 0;
  let verified = 0;
  let skipped = 0;
  for (const it of items) {
    if (!PLACE_TYPES.includes(it.type) || !it.placeQuery) continue;
    if (it.verificationStatus === 'VERIFIED' && it.lat != null) continue; // 이미 확인된 장소(수정 제안에서 이어받음)
    it.placeName = it.placeQuery;
    const key = it.placeQuery;
    if (!cache.has(key)) {
      if (!search.kakaoKey && search.nominatimBudget <= 0) { skipped++; continue; }
      cache.set(key, await search.find(key, center));
      checked++;
    }
    const hit = cache.get(key);
    if (hit) {
      Object.assign(it, { placeName: hit.name, address: hit.address, lat: hit.lat, lng: hit.lng, matchedPlaceId: hit.id, verificationStatus: 'VERIFIED' });
      verified++;
    } else {
      Object.assign(it, { lat: null, lng: null, address: null, matchedPlaceId: null, verificationStatus: 'UNVERIFIED' });
    }
  }
  return { checked, verified, skipped };
}
