// MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md)
/*
 * isolation-failure.test.mjs — 격리 시험의 "실패 상황" 시험 (2-1단계)
 *
 * 무엇: 격리 시험이 실패해야 할 때 실제로 실패하는지, 판정 불가를 통과로 바꾸지 않는지 확인한다.
 *   (가) 격리 도구 실패: sudo·setpriv·unshare가 실패하면 격리 방법을 고르지 못한다(null) → 판정 불가.
 *   (나) 격리 생성 실패를 숨기지 않음: 격리하지 않는 가짜 방법(fake-noop)으로 격리 시험을 돌리면
 *        시험 파일 전체가 "실패"로 끝나야 한다.
 *   (다) 판정 불가 처리: 격리 방법이 없을 때 MZK_REQUIRE_ISOLATION=1이면 실패,
 *        없으면 건너뜀(현재 CI 기본값 — 워크플로 변경은 발주자 별도 승인 대상)으로 끝난다.
 * 안전: 가짜 명령은 임시 폴더에 만든 "exit 1"짜리 스크립트뿐이다. 외부 통신을 하지 않는다.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chooseIsolation } from "./harness/isolate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ISOLATION_TEST = path.join(here, "network-isolation.test.mjs");

/* 임시 폴더에 항상 실패하는 가짜 명령 하나를 만든다 */
function fakeFailing(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mzk-fake-"));
  const p = path.join(dir, name);
  fs.writeFileSync(p, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  return p;
}

/* 격리 시험 파일을 별도 프로세스로 실행하고 종료 코드와 집계를 돌려준다 */
function runIsolationTests(extraEnv) {
  // NODE_TEST_CONTEXT: 시험 실행기가 자식에게 넘기는 값. 남아 있으면 자식이 실패해도 종료 코드 0으로 끝나므로 지운다.
  const env = { ...process.env, ...extraEnv };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ["--test", ISOLATION_TEST], { env, encoding: "utf8", timeout: 240000 });
  const num = k => Number((r.stdout.match(new RegExp(`^# ${k} (\\d+)`, "m")) || [])[1] ?? NaN);
  return { status: r.status, pass: num("pass"), fail: num("fail"), skipped: num("skipped"), out: r.stdout };
}

/* ---- (가) 격리 도구 실패 ---- */
test("sudo가 실패하면 sudo 방법을 고르지 못한다(판정 불가)", () => {
  const r = chooseIsolation("sudo", { sudo: fakeFailing("sudo") });
  assert.equal(r.method, null);
  assert.match(r.reason, /sudo: 실패/);
});

test("setpriv가 실패하면 sudo 방법을 고르지 못한다(판정 불가)", () => {
  const r = chooseIsolation("sudo", { setpriv: fakeFailing("setpriv") });
  assert.equal(r.method, null);
});

test("unshare가 실패하면 userns 방법을 고르지 못한다(판정 불가)", () => {
  const r = chooseIsolation("userns", { unshare: fakeFailing("unshare") });
  assert.equal(r.method, null);
});

test("auto에서 두 방법이 모두 실패하면 이유를 모두 남기고 null", () => {
  const r = chooseIsolation("auto", { unshare: fakeFailing("unshare"), sudo: fakeFailing("sudo") });
  assert.equal(r.method, null);
  assert.match(r.reason, /userns: 실패/);
  assert.match(r.reason, /sudo: 실패/);
});

test("알 수 없는 방법 이름은 null", () => {
  assert.equal(chooseIsolation("bogus").method, null);
});

/* ---- (나) 격리하지 않는 가짜 방법이면 격리 시험이 실패로 끝나야 한다 ---- */
test("격리하지 않는 가짜 방법(fake-noop)으로 돌리면 격리 시험 파일이 실패로 끝난다", () => {
  const r = runIsolationTests({ MZK_ISOLATION: "fake-noop" });
  assert.notEqual(r.status, 0, "격리가 없는데 격리 시험이 성공으로 끝남 — 시험이 격리 실패를 못 잡음");
  assert.ok(r.fail > 0, `실패 수가 0: ${r.fail}`);
  assert.match(r.out, /lo뿐이다|격리 실패|NoNewPrivs/, "어떤 시험이 격리 실패를 잡았는지 출력에 없음");
});

/* ---- (다) 판정 불가 처리 ---- */
test("격리 방법이 없고 MZK_REQUIRE_ISOLATION=1이면 격리 시험 파일이 실패로 끝난다", () => {
  const r = runIsolationTests({ MZK_ISOLATION: "bogus", MZK_REQUIRE_ISOLATION: "1" });
  assert.notEqual(r.status, 0, "판정 불가가 실패로 바뀌지 않음");
  assert.ok(r.fail > 0);
});

test("격리 방법이 없고 MZK_REQUIRE_ISOLATION이 없으면 건너뜀으로 끝난다(통과로 세지 않음 — 현재 CI 기본값)", () => {
  const r = runIsolationTests({ MZK_ISOLATION: "bogus", MZK_REQUIRE_ISOLATION: "" });
  assert.equal(r.status, 0);
  assert.ok(r.skipped > 0, "건너뛴 시험이 0개 — 판정 불가가 표시되지 않음");
});
