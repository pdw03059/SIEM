// MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md)
/*
 * mock-env.mjs — 시험 대상 스크립트보다 먼저 불러오는 가짜 환경 (node --import 로 주입)
 *
 * 무엇: 전역 fetch와 Date를 가짜로 바꿔 끼운다.
 *   - fetch: 실제 네트워크로 나가지 않고, 시나리오 파일(MOCK_SCENARIO)에 적힌 응답을
 *     "요청 주소 규칙"에 맞춰 돌려준다. 모든 요청은 MOCK_LOG 파일에 순서대로 기록한다.
 *   - Date: 인자 없이 new Date()를 부르면 고정 시각(MOCK_NOW)을 돌려준다.
 *     보고서 파일 이름과 날짜가 매번 같아져 정답 파일과 비교할 수 있다.
 * 왜: 기존 스크립트(ai-discussion.mjs)를 한 글자도 고치지 않고 시험하기 위해서다.
 *     스크립트는 함수를 내보내지 않고 불러오는 즉시 main()을 실행하므로,
 *     바깥(전역 객체)에서 의존성을 바꿔 끼우는 방법밖에 없다.
 * 안전: 규칙에 없는 주소로 요청하면 즉시 오류를 던진다(실제 API로 새는 것 방지).
 */
import fs from "node:fs";

/* ---- 1. 시나리오와 기록 파일 경로를 환경 변수에서 읽는다 ---- */
const scenarioPath = process.env.MOCK_SCENARIO;
const logPath = process.env.MOCK_LOG;
if (!scenarioPath || !logPath) {
  throw new Error("mock-env: MOCK_SCENARIO and MOCK_LOG are required");
}
const scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));

/* ---- 2. 시각 고정: 인자 없는 new Date()와 Date.now()만 바꾼다 ---- */
const FIXED_MS = Date.parse(process.env.MOCK_NOW || "2026-10-31T10:00:00Z");
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...args) {
    // 인자가 없을 때만 고정 시각, 있으면 원래 동작 그대로
    super(...(args.length ? args : [FIXED_MS]));
  }
  static now() {
    return FIXED_MS;
  }
}
globalThis.Date = FixedDate;

/* ---- 3. 요청 기록: 한 줄에 요청 하나(JSON Lines) ---- */
fs.writeFileSync(logPath, "");
function record(entry) {
  fs.appendFileSync(logPath, JSON.stringify(entry) + "\n");
}

/* ---- 4. 시나리오 규칙 찾기 ----
 * 규칙 형식: { "method": "GET", "match": "/pulls/7/files", "times": 1,
 *             "status": 200, "json": {...} 또는 "text": "..." }
 * match는 주소에 포함되는 문자열. 같은 규칙에 times가 있으면 그 횟수만큼만 쓰고 다음 규칙으로 넘어간다.
 * 각 규칙이 몇 번 쓰였는지 세어 둔다. */
const used = new Array(scenario.routes.length).fill(0);
function findRoute(method, url) {
  for (let i = 0; i < scenario.routes.length; i++) {
    const r = scenario.routes[i];
    const limit = r.times ?? Infinity;
    if (r.method === method && url.includes(r.match) && used[i] < limit) {
      used[i]++;
      return r;
    }
  }
  return null;
}

/* ---- 5. 요청 본문 정리: JSON이면 객체로, 아니면 문자열 그대로 ---- */
function parseBody(body) {
  if (body == null) return null;
  try {
    return JSON.parse(body);
  } catch {
    return String(body);
  }
}

/* ---- 6. 인증 헤더는 값 대신 "있음/없음"만 기록(가짜 키라도 기록에 남기지 않는 습관) ---- */
function headerSummary(headers = {}) {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    authorization: lower.authorization ? "<present>" : "<absent>",
    "x-api-key": lower["x-api-key"] ? "<present>" : "<absent>",
    "anthropic-version": lower["anthropic-version"] ?? null,
    "x-github-api-version": lower["x-github-api-version"] ?? null
  };
}

/* ---- 7. 가짜 fetch 본체 ---- */
globalThis.fetch = async (url, options = {}) => {
  const method = (options.method || "GET").toUpperCase();
  const route = findRoute(method, String(url));
  record({
    method,
    url: String(url),
    headers: headerSummary(options.headers),
    body: parseBody(options.body),
    matched: route ? route.match : null
  });
  if (!route) {
    // 예상하지 못한 요청: 시험을 실패시키기 위해 네트워크 오류처럼 던진다
    throw new Error(`mock-env: unexpected request ${method} ${url}`);
  }
  const text = route.text ?? (route.json === undefined ? "" : JSON.stringify(route.json));
  return new Response(text, {
    status: route.status ?? 200,
    headers: { "content-type": "application/json" }
  });
};
