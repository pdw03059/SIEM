// MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md)
/*
 * net-boundary.mjs — 통신 코드 위치 검사기(정적 검사)
 *
 * 무엇: 소스 글자를 읽어 "네트워크에 나갈 수 있는 코드"를 찾는다.
 *   - fetch( 호출
 *   - 네트워크·프로세스 모듈 불러오기: net, http, https, http2, tls, dns, dgram,
 *     child_process, worker_threads, cluster, undici (node: 접두사 포함)
 *   - 동적 불러오기 import( / require(
 *   - 우회에 쓰일 수 있는 이름: globalThis, process.binding, WebSocket, XMLHttpRequest, EventSource
 * 규칙: transport.mjs만 fetch를 쓸 수 있다. 그 밖의 위 항목은 어떤 운영 파일에서도 금지.
 * 한계: 글자 검사라서 의도적으로 숨긴 코드(문자열을 이어 붙여 이름 만들기 등)까지 막지는 못한다.
 *   그래서 네트워크 격리 시험(운영체제 수준)과 함께 쓴다.
 */
import fs from "node:fs";
import path from "node:path";

const NET_MODULES = "net|http|https|http2|tls|dns|dgram|child_process|worker_threads|cluster|undici";

/* 검사 규칙: [이름, 정규식, transport.mjs에서는 허용하는지] */
const RULES = [
  ["fetch 호출", /\bfetch\s*\(/, true],
  ["네트워크 모듈 import", new RegExp(`from\\s*["'](?:node:)?(?:${NET_MODULES})(?:/[^"']*)?["']`), false],
  ["네트워크 모듈 import(부수효과)", new RegExp(`import\\s*["'](?:node:)?(?:${NET_MODULES})(?:/[^"']*)?["']`), false],
  ["동적 import()", /\bimport\s*\(/, false],
  ["require()", /\brequire\s*\(/, false],
  ["globalThis 접근", /\bglobalThis\b/, false],
  ["process.binding", /process\s*\.\s*binding/, false],
  ["WebSocket", /\bWebSocket\b/, false],
  ["XMLHttpRequest", /\bXMLHttpRequest\b/, false],
  ["EventSource", /\bEventSource\b/, false]
];

/* 주석을 지운 뒤 검사한다(주석 속 설명 문장 때문에 잘못 걸리지 않게) */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/* 글자 하나(파일 하나)를 검사해 위반 목록을 돌려준다 */
export function scanSource(src, { isTransport = false } = {}) {
  const code = stripComments(src);
  const found = [];
  for (const [name, re, allowedInTransport] of RULES) {
    if (re.test(code) && !(isTransport && allowedInTransport)) found.push(name);
  }
  return found;
}

/* 운영 파일 목록: .github/scripts 아래 .mjs 중 test/ 폴더를 뺀 전부(새 파일도 자동 포함) */
export function productionFiles(scriptsDir) {
  const out = [];
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "test") walk(p); }
      else if (e.name.endsWith(".mjs") || e.name.endsWith(".js") || e.name.endsWith(".cjs")) out.push(p);
    }
  };
  walk(scriptsDir);
  return out.sort();
}
