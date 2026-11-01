/* MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md) */
// 민감정보 검사기 — 외부 AI로 보내기 전(입력)과 공개 브랜치에 저장하기 전(출력)에 같은 규칙으로 검사한다.
//
// 원칙: 의심되면 막는다(거짓 양성은 그날 교재를 건너뛸 뿐이지만, 거짓 음성은 공개 유출이다).
// 결과에는 값 자체를 절대 담지 않는다(Actions 로그·댓글이 공개이므로). 종류·위치만 남긴다.

// 검사 규칙: [종류, 정규식]. 새 규칙은 이 표에 한 줄 추가로 끝난다.
export const SECRET_RULES = Object.freeze([
  ["개인키", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["AWS 접근 키", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub 토큰", /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/],
  ["AI API 키", /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/],
  ["Slack 토큰", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["Bearer 토큰 값", /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/],
  ["계정이 든 접속 주소", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/'"`]+:[^\s@/'"`]+@/i],
  ["주민등록번호 형식", /\b\d{6}-[1-4]\d{6}\b/]
]);

// 비밀번호·키 대입문: 따옴표 안 값이 자리표시자가 아니면 막는다.
const ASSIGN_RE = /\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\b\s*[:=]\s*["']([^"'\s]{6,})["']/gi;
const PLACEHOLDER_RE = /^(?:<.*>|\$\{.*\}|\*+|x+|changeme|example\w*|dummy\w*|test\w*|placeholder|redacted)$/i;

// IPv4: 고객 내부망(사설 대역) 주소도 막는다. 루프백·미지정·브로드캐스트·문서용 대역(RFC 5737)만 허용.
const IPV4_RE = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])/g;
function allowedIp(o) {
  if (o.some(n => n > 255)) return true; // IP가 아닌 숫자열(버전 등)
  const s = o.join(".");
  if (o[0] === 127 || s === "0.0.0.0" || s === "255.255.255.255") return true;
  return ["192.0.2", "198.51.100", "203.0.113"].includes(o.slice(0, 3).join("."));
}

/** 한 줄을 검사해 발견한 종류 목록을 돌려준다. */
function scanLine(line) {
  const found = [];
  for (const [type, re] of SECRET_RULES) if (re.test(line)) found.push(type);
  for (const m of line.matchAll(ASSIGN_RE)) {
    if (!PLACEHOLDER_RE.test(m[2])) found.push("비밀번호·키 대입");
  }
  for (const m of line.matchAll(IPV4_RE)) {
    if (!allowedIp(m.slice(1, 5).map(Number))) found.push("IP 주소");
  }
  return found;
}

/**
 * 여러 출처를 검사한다. sources: [{ name, text }]
 * 반환: [{ source, line, type }] — 값은 담지 않는다.
 */
export function scanSources(sources) {
  const findings = [];
  for (const { name, text } of sources) {
    if (!text) continue;
    text.split(/\r?\n/).forEach((line, i) => {
      for (const type of new Set(scanLine(line))) findings.push({ source: name, line: i + 1, type });
    });
  }
  return findings;
}

/** 공개해도 되는 요약(종류·위치만). 너무 길면 앞부분만. */
export function describeFindings(findings, max = 20) {
  const lines = findings.slice(0, max).map(f => `- ${f.type}: \`${f.source}\` ${f.line}번째 줄`);
  if (findings.length > max) lines.push(`- 외 ${findings.length - max}건`);
  return lines.join("\n");
}
