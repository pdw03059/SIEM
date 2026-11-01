/* MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md) */
// learning/secrets.mjs 시험 — 시험용 값은 모두 실존하지 않는 가짜이며, 실행 중 조립해 저장소 검사기에 걸리지 않게 한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanSources, describeFindings } from "./secrets.mjs";

const j = (...p) => p.join("");
const types = text => scanSources([{ name: "t", text }]).map(f => f.type);

test("토큰·키 형식 탐지", () => {
  assert.ok(types(j("-----BEGIN RSA ", "PRIVATE KEY-----")).includes("개인키"));
  assert.ok(types(j("AKIA", "ABCDEFGHIJKLMNOP")).includes("AWS 접근 키"));
  assert.ok(types(j("ghp_", "a".repeat(30))).includes("GitHub 토큰"));
  assert.ok(types(j("sk-", "proj-", "b".repeat(30))).includes("AI API 키"));
  assert.ok(types(j("xoxb-", "1234567890-abc")).includes("Slack 토큰"));
  assert.ok(types(j("eyJ", "a".repeat(12), ".", "b".repeat(12), ".", "c".repeat(12))).includes("JWT"));
  assert.ok(types(j("Authorization: Bearer ", "Z".repeat(30))).includes("Bearer 토큰 값"));
  assert.ok(types(j("postgres://admin:", "s3cr3t@db.local/app")).includes("계정이 든 접속 주소"));
  assert.ok(types(j("900101-", "1234567")).includes("주민등록번호 형식"));
});

test("비밀번호 대입: 실제 값은 막고 자리표시자는 허용", () => {
  assert.ok(types(j('password = "', 'Hunter2Real"')).includes("비밀번호·키 대입"));
  assert.ok(types(j("api_key: '", "Q9w8E7r6T5'")).includes("비밀번호·키 대입"));
  for (const ph of ['"<your-password>"', '"${PASSWORD}"', '"********"', '"changeme"', '"example123"']) {
    assert.ok(!types(`password = ${ph}`).includes("비밀번호·키 대입"), ph);
  }
});

test("코드 속 템플릿 문자열은 오탐하지 않음", () => {
  assert.deepEqual(types("Authorization: `Bearer ${cfg.token}`,"), []);
  assert.deepEqual(types("const OPENAI_API_KEY = process.env.OPENAI_API_KEY;"), []);
});

test("IP: 사설·공인 대역은 막고 루프백·문서용 대역·버전 문자열은 허용", () => {
  for (const ip of ["10.1.2.3", "172.16.0.9", "192.168.10.20", "8.8.8.8"]) assert.ok(types(`host ${ip}`).includes("IP 주소"), ip);
  for (const ok of ["127.0.0.1", "0.0.0.0", "255.255.255.255", "192.0.2.10", "198.51.100.1", "203.0.113.7", "v1.2.3", "999.1.1.1"]) {
    assert.ok(!types(`x ${ok} y`).includes("IP 주소"), ok);
  }
});

test("결과에는 값을 담지 않고 종류·위치만", () => {
  const secret = j("ghp_", "S".repeat(30));
  const f = scanSources([{ name: "src/a.c", text: `ok\nkey ${secret}` }]);
  assert.deepEqual(f, [{ source: "src/a.c", line: 2, type: "GitHub 토큰" }]);
  const d = describeFindings(f);
  assert.match(d, /src\/a\.c.*2번째 줄/);
  assert.ok(!d.includes(secret));
});

test("요약 길이 제한", () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ source: "s", line: i + 1, type: "IP 주소" }));
  assert.match(describeFindings(many), /외 5건/);
});
