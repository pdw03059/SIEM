// MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md)
/*
 * network-isolation.test.mjs — 운영체제 수준 네트워크 격리 시험 (2단계)
 *
 * 무엇: unshare -rn(새 사용자·네트워크 공간)으로 만든 격리 공간 안팎에서 같은 연결 시도를 한다.
 *   - 대조: 격리 밖에서는 각 경로가 연결돼야 한다. 연결되지 않으면 그 경로는 "판정 불가"(건너뜀, 통과 아님).
 *   - 차단: 격리 안에서는 모든 경로가 실패해야 한다. 하나라도 연결되면 실패.
 *   - 격리 확인: 격리 안의 네트워크 장치가 lo(자기 자신)뿐인지.
 *   - DNS 시도 확인: strace로 격리 안의 이름 조회가 실제로 이름 서버(53번 포트)에 연결을 시도했다가
 *     "네트워크 없음"으로 실패했는지 기록에서 확인(시도조차 안 한 실패와 구분).
 *   - 시험 장치 오프라인 확인: 회귀 시나리오(정상 흐름)를 격리 안에서 돌려도 정답과 같은지.
 * 한계: 대표 경로 10가지를 확인하는 시험이며, 가능한 모든 통신 방법을 증명하지는 않는다.
 *   GitHub Actions 실행기에서 unshare가 되는지는 2-1단계에서 따로 확인한다.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import tls from "node:tls";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PROBE_NAMES, classify } from "./harness/net-probe.mjs";
import { SCENARIOS } from "./harness/scenarios.mjs";
import { runScenario } from "./harness/run-scenario.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROBE = path.join(here, "harness", "net-probe.mjs");
const INCONCLUSIVE = "판정 불가";

/* ---- 도우미: 탐침 실행(격리 여부 선택) ---- */
function probe(isolate, names = []) {
  const base = [process.execPath, PROBE, ...names];
  const [cmd, ...args] = isolate ? ["unshare", "-rn", ...base] : base;
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 60000 });
  if (r.error || r.status !== 0) return { error: r.error?.code || r.stderr || `exit ${r.status}` };
  return JSON.parse(r.stdout);
}

/* ---- 판정 기준 시험: 인증서 검증 오류만 "닿음", 그 밖의 TLS·네트워크 오류는 "실패" (격리 여부와 무관하게 항상 실행) ---- */
test("판정 기준: 인증서 검증 오류(정확히 일치하는 코드)만 연결됨으로 본다", () => {
  for (const code of ["ERR_TLS_CERT_ALTNAME_INVALID", "DEPTH_ZERO_SELF_SIGNED_CERT", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"]) {
    assert.equal(classify({ code }).ok, true, code);
    assert.equal(classify({ cause: { code } }).ok, true, `fetch 형식(cause): ${code}`);
  }
});

test("판정 기준: 인증서를 받았다는 증거가 없는 TLS 오류와 네트워크 오류는 실패로 본다", () => {
  const notReached = [
    "ERR_TLS_INVALID_PROTOCOL_VERSION", "ERR_TLS_HANDSHAKE_TIMEOUT", "ERR_TLS_INVALID_CONTEXT",
    "ERR_SSL_WRONG_VERSION_NUMBER", "ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE",
    "ERR_TLS_CERT_ALTNAME_INVALID_X", "CERT_", "UNABLE_TO_", // 앞부분만 같은 가짜 코드도 실패여야 함
    "ENETUNREACH", "ECONNREFUSED", "EAI_AGAIN", "ETIMEDOUT", "TIMEOUT"
  ];
  for (const code of notReached) assert.equal(classify({ code }).ok, false, code);
});

/* ---- 판정 기준 실측: 내 컴퓨터 안(127.0.0.1)에서 실제 상황을 만들어 분류가 맞는지 확인 ----
 * 외부 네트워크는 쓰지 않는다. 자체 서명 인증서는 시험할 때마다 임시 폴더에 새로 만들고 지운다(저장소에 키를 두지 않음).
 *   (1) 자체 서명 인증서 서버에 접속 → 인증서를 실제로 받은 뒤 검증 오류 → "닿음"이어야 함
 *   (2) 아무도 듣지 않는 포트에 접속 → 연결 거부 → "실패"여야 함
 *   (3) 접속 전 로컬 설정 오류(존재하지 않는 TLS 버전 "TLSv9" 지정) → ERR_TLS_로 시작하지만 서버에 닿지 않음 → "실패"여야 함
 *       서버가 듣고 있는 포트로 시도해서, 닿을 수 있는데도 로컬 오류로 끝난다는 것을 보인다.
 *       예전 규칙(ERR_TLS_ 앞부분 일치)이었다면 (3)을 "닿음"으로 잘못 판정했을 것임을 함께 확인한다. */
function tlsAttempt(options) {
  return new Promise(resolve => {
    try {
      const s = tls.connect(options, () => { s.destroy(); resolve({ connected: true }); });
      s.on("error", e => resolve({ error: e }));
    } catch (e) {
      resolve({ error: e }); // 설정 오류는 연결 시도 전에 바로 던져진다
    }
  });
}

test("판정 기준 실측: 인증서 오류=닿음, 연결 거부·로컬 설정 오류=실패", async t => {
  const hasOpenssl = spawnSync("openssl", ["version"]).status === 0;
  if (!hasOpenssl) return t.skip(`${INCONCLUSIVE}: openssl 없음`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mzk-tls-"));
  try {
    const gen = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
      "-subj", "/CN=mzk-test", "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem")]);
    assert.equal(gen.status, 0, "시험용 인증서 생성 실패");
    const server = tls.createServer({ key: fs.readFileSync(path.join(dir, "k.pem")), cert: fs.readFileSync(path.join(dir, "c.pem")) }, s => s.end());
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;

    const selfSigned = await tlsAttempt({ host: "127.0.0.1", port, servername: "mzk-test" });
    const local = await tlsAttempt({ host: "127.0.0.1", port, minVersion: "TLSv9" }); // 서버는 듣는 중, 로컬 설정 오류
    await new Promise(r => server.close(r));
    const closed = await tlsAttempt({ host: "127.0.0.1", port }); // 서버를 닫은 뒤 같은 포트 → 연결 거부

    assert.equal(selfSigned.error?.code, "DEPTH_ZERO_SELF_SIGNED_CERT");
    assert.equal(classify(selfSigned.error).ok, true, "인증서를 받은 경우는 닿음이어야 함");
    assert.equal(closed.error?.code, "ECONNREFUSED");
    assert.equal(classify(closed.error).ok, false, "연결 거부는 실패여야 함");
    assert.match(local.error?.code ?? "", /^ERR_TLS_/, "로컬 설정 오류도 ERR_TLS_로 시작함(예전 규칙의 오판 사례)");
    assert.equal(classify(local.error).ok, false, "로컬 설정 오류는 실패여야 함");
    t.diagnostic(`자체 서명: ${selfSigned.error.code} → 닿음 / 닫힌 포트: ${closed.error.code} → 실패 / 로컬 설정: ${local.error.code} → 실패`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// unshare를 쓸 수 있는지 먼저 확인(못 쓰면 이 파일의 시험은 전부 판정 불가)
const canIsolate = spawnSync("unshare", ["-rn", "true"]).status === 0;
const outside = probe(false);
const inside = canIsolate ? probe(true) : null;

test("격리 공간 안의 네트워크 장치는 lo뿐이다", t => {
  if (!canIsolate) return t.skip(`${INCONCLUSIVE}: unshare -rn 사용 불가`);
  assert.ok(!inside.error, `격리 탐침 실행 실패: ${inside.error}`);
  assert.deepEqual(inside.interfaces, ["lo"]);
  assert.ok(outside.interfaces.some(i => i !== "lo"), "격리 밖에도 lo뿐이면 대조가 성립하지 않음");
});

for (const name of PROBE_NAMES) {
  test(`경로 ${name}: 격리 밖 연결됨(대조) / 격리 안 차단`, t => {
    if (!canIsolate) return t.skip(`${INCONCLUSIVE}: unshare -rn 사용 불가`);
    const o = outside.results[name];
    if (!o.ok) return t.skip(`${INCONCLUSIVE}: 격리 밖에서도 연결 안 됨(${o.code})`);
    const i = inside.results[name];
    assert.equal(i.ok, false, `격리 안에서 ${name} 연결이 성공함 — 격리 실패`);
    t.diagnostic(`격리 밖: ${o.note ?? "연결됨"} / 격리 안: 차단(${i.code})`);
  });
}

test("DNS: 격리 안 이름 조회가 이름 서버 연결을 실제로 시도했다가 '네트워크 없음'으로 실패", t => {
  if (!canIsolate) return t.skip(`${INCONCLUSIVE}: unshare -rn 사용 불가`);
  const hasStrace = spawnSync("strace", ["-V"]).status === 0;
  if (!hasStrace) return t.skip(`${INCONCLUSIVE}: strace 없음`);
  const r = spawnSync("unshare", ["-rn", "strace", "-f", "-e", "trace=connect,sendto,sendmmsg",
    process.execPath, PROBE, "dns-lookup", "dns-resolve"], { encoding: "utf8", timeout: 60000 });
  if (r.status !== 0) return t.skip(`${INCONCLUSIVE}: strace 실행 실패(${r.stderr.split("\n")[0]})`);
  const lines = r.stderr.split("\n").filter(l => /htons\(53\)/.test(l));
  assert.ok(lines.length > 0, "53번 포트 연결 시도 기록이 없음 — 시도하지 않은 실패일 수 있음");
  assert.ok(lines.every(l => /ENETUNREACH/.test(l)), `53번 포트 시도 중 '네트워크 없음'이 아닌 결과가 있음:\n${lines.join("\n")}`);
  const res = JSON.parse(r.stdout).results;
  assert.equal(res["dns-lookup"].ok, false);
  assert.equal(res["dns-resolve"].ok, false);
  t.diagnostic(`53번 포트 연결 시도 ${lines.length}회, 모두 ENETUNREACH`);
});

test("시험 장치는 네트워크 없이 돈다: 정상 시나리오를 격리 안에서 실행해도 정답과 같다", t => {
  if (!canIsolate) return t.skip(`${INCONCLUSIVE}: unshare -rn 사용 불가`);
  const s = SCENARIOS.find(x => x.name === "01-normal");
  const golden = JSON.parse(fs.readFileSync(path.join(here, "golden", "01-normal.json"), "utf8"));
  const r = runScenario(s, undefined, { isolate: true });
  assert.deepEqual({ description: s.description, ...r }, golden);
});
