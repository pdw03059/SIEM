// MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md)
/*
 * transport.mjs — 외부 네트워크 통신의 유일한 출입구
 *
 * 무엇: GitHub·OpenAI·Claude로 나가는 모든 HTTP 요청이 이 함수 하나를 거친다.
 * 왜: 통신 지점이 하나면 나중에 재시도, 호출 횟수 제한, 토큰 집계, DRY_RUN 차단(4단계)을
 *     이 한 곳에만 넣으면 된다. 다른 파일에서 fetch나 네트워크 모듈을 직접 쓰면
 *     회귀 시험(transport-boundary)이 실패하도록 막아 두었다.
 * 주의(2단계): 지금은 원본과 똑같이 전역 fetch를 그대로 부른다. 동작 변화 없음.
 */

/* 요청 하나를 보내고 Response를 돌려준다(전역 fetch와 같은 형식) */
export async function send(url, options) {
  return fetch(url, options);
}
