// Supabase 프로젝트 연결 정보
// Supabase 대시보드 > Project Settings > API (또는 Connect) 에서 복사해 넣어요.
// - url: Project URL (예: https://abcdefghijkl.supabase.co)
// - key: publishable 키(sb_publishable_...) 또는 anon public 키
// 이 두 값은 원래 웹페이지에 공개되는 값이라 GitHub에 올려도 괜찮아요.
// (데이터는 schema.sql 의 권한 규칙으로 보호돼요. service_role/secret 키는 절대 넣지 마세요!)
window.TRAVEL_CONFIG = {
  url: 'https://bkqvcexlcqfciscdgodr.supabase.co',
  key: 'sb_publishable_H_RGx_BgkZNmHDjkOLZsVQ_hONoHQr-',
  // 카카오 장소 검색 (한국 장소 이름·근처 후보). Kakao Developers > 앱 > 앱 키 > JavaScript 키
  // 웹 페이지에 공개되는 키라 괜찮아요. 대신 카카오 앱 설정에 사이트 도메인을 등록해야 이 사이트에서만 동작해요.
  kakaoKey: '3aab8ec1bdc13930b9331492396f905d',
};
