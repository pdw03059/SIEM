// MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md)
/*
 * transport-boundary.test.mjs — "외부 통신은 ai/transport.mjs 한 곳에서만" 규칙 검사 (2단계)
 *
 * (가) 검사기 자체 시험: 일부러 만든 위반 예시를 검사기가 실제로 잡는지 먼저 확인한다.
 *      이게 없으면 검사기가 고장 나서 아무것도 못 잡아도 "위반 0건"으로 통과해 버린다.
 * (나) 운영 파일 검사: .github/scripts 아래(test/ 제외) 모든 .mjs/.js/.cjs 파일.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanSource, productionFiles } from "./harness/net-boundary.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(here, "..");
const TRANSPORT = path.join(SCRIPTS, "ai", "transport.mjs");

test("검사기 자체 시험: 위반 예시를 모두 잡는다", () => {
  const bad = {
    'await fetch("https://x")': "fetch 호출",
    'import http from "node:http";': "네트워크 모듈 import",
    'import { connect } from "net";': "네트워크 모듈 import",
    'import { spawn } from "node:child_process";': "네트워크 모듈 import",
    'import "node:dns";': "네트워크 모듈 import(부수효과)",
    'const m = await import("node:" + "net");': "동적 import()",
    'const n = require("net");': "require()",
    'globalThis["fe" + "tch"]("https://x")': "globalThis 접근",
    'process.binding("tcp_wrap")': "process.binding",
    'new WebSocket("wss://x")': "WebSocket"
  };
  for (const [src, rule] of Object.entries(bad)) {
    assert.ok(scanSource(src).includes(rule), `못 잡음: ${src}`);
  }
});

test("검사기 자체 시험: transport.mjs의 fetch는 허용, 주석·URL 글자는 오탐하지 않음", () => {
  assert.deepEqual(scanSource("return fetch(url, options);", { isTransport: true }), []);
  assert.deepEqual(scanSource('// fetch(x) 설명\n/* require("net") */\nconst u = "https://a/b";'), []);
  // transport.mjs라도 fetch 외의 위반은 잡는다
  assert.ok(scanSource('import net from "node:net";', { isTransport: true }).includes("네트워크 모듈 import"));
});

test("운영 파일 검사: transport.mjs 밖에는 통신 코드가 없다", () => {
  const files = productionFiles(SCRIPTS);
  assert.ok(files.includes(TRANSPORT), "transport.mjs가 검사 목록에 없음");
  assert.ok(files.length >= 7, `검사 파일 수가 너무 적음: ${files.length}`);
  const violations = {};
  for (const f of files) {
    const found = scanSource(fs.readFileSync(f, "utf8"), { isTransport: f === TRANSPORT });
    if (found.length) violations[path.relative(SCRIPTS, f)] = found;
  }
  assert.deepEqual(violations, {});
});

test("transport.mjs는 실제로 fetch를 쓴다(출입구가 비어 있지 않음)", () => {
  assert.match(fs.readFileSync(TRANSPORT, "utf8"), /\bfetch\s*\(/);
});
