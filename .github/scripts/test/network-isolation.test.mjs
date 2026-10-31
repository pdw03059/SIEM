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
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PROBE_NAMES } from "./harness/net-probe.mjs";
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
    t.diagnostic(`격리 밖: 연결됨 / 격리 안: 차단(${i.code})`);
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
