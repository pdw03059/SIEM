// MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md)
/*
 * run-scenario.mjs — 시나리오 하나로 기존 스크립트를 별도 프로세스에서 실행하고 결과를 정리
 *
 * 무엇: node --import mock-env.mjs ai-discussion.mjs 를 자식 프로세스로 실행한 뒤
 *       (종료 코드, 표준 출력·오류, 요청 기록)을 비교하기 좋은 형태로 돌려준다.
 * 왜 별도 프로세스: 대상 스크립트는 불러오는 즉시 실행되고 process.exit(1)로 끝날 수 있다.
 *       같은 프로세스에서 불러오면 시험 프로그램까지 함께 종료된다.
 * 정규화: PUT으로 저장하는 파일 내용(base64)을 글자로 풀어 정답 파일에서 읽을 수 있게 한다.
 *       시각과 실행 번호는 mock-env와 환경 변수로 고정했으므로 따로 지우지 않는다.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ---- 1. 경로 계산: 이 파일 기준으로 대상 스크립트와 mock 위치를 찾는다 ---- */
const here = path.dirname(fileURLToPath(import.meta.url));
export const TARGET = path.resolve(here, "../../ai-discussion.mjs"); // 모듈 분리 후 진입 파일(신규)
export const LEGACY = path.resolve(here, "../legacy/ai-discussion.v0.mjs"); // 모듈 분리 전 원본 보존본(기준점)
const MOCK = path.resolve(here, "mock-env.mjs");

/* ---- 2. 요청 기록 한 건을 읽기 좋게 정리 ---- */
function normalizeEntry(e) {
  const out = { method: e.method, url: e.url, headers: e.headers, matched: e.matched };
  const body = e.body;
  if (body && typeof body === "object" && typeof body.content === "string" && e.method === "PUT") {
    // GitHub Contents API 저장 요청: base64 내용을 글자로 풀어 둔다
    const { content, ...rest } = body; // content(base64)는 빼고 풀어 쓴 글자로 바꿔 둔다
    out.body = { ...rest, decoded_content: Buffer.from(content, "base64").toString("utf8") };
  } else {
    out.body = body;
  }
  return out;
}

/* ---- 3. 시나리오 실행 ---- */
// target: 실행할 스크립트(신규 또는 원본)
// isolate: 격리 명령 앞부분(isolate.mjs의 prefix). 주면 네트워크가 없는 격리 공간 안에서 실행 — 시험 자체가 네트워크 없이 도는지 확인용
export function runScenario(scenario, target = TARGET, { isolate = null } = {}) {
  // 시나리오와 기록 파일은 운영체제 임시 폴더 안의 새 폴더에 둔다(저장소를 더럽히지 않음)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mzk-${scenario.name}-`));
  const scenarioFile = path.join(dir, "scenario.json");
  const logFile = path.join(dir, "requests.jsonl");
  fs.writeFileSync(scenarioFile, JSON.stringify({ routes: scenario.routes }));

  // 부모 환경 변수를 물려주지 않는다: 실제 키가 우연히 들어가는 것을 막기 위해 필요한 것만 넘김
  const env = {
    PATH: process.env.PATH,
    MOCK_SCENARIO: scenarioFile,
    MOCK_LOG: logFile,
    MOCK_NOW: "2026-10-31T10:00:00Z",
    ...scenario.env
  };

  const nodeArgs = [process.execPath, "--import", MOCK, target];
  // 격리 실행 시: sudo는 환경 변수를 지우므로, env -i로 위 env를 그대로 다시 넣는다(두 방법 모두 같은 환경이 되게).
  // 값이 명령줄 인자로 보이지만, 시험용 가짜 값뿐이다.
  const envArgs = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  const [cmd, ...args] = isolate ? [...isolate, "env", "-i", ...envArgs, ...nodeArgs] : nodeArgs;
  const child = spawnSync(cmd, args, {
    env,
    encoding: "utf8",
    timeout: 20000
  });

  const lines = fs.existsSync(logFile)
    ? fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l))
    : [];
  fs.rmSync(dir, { recursive: true, force: true });

  return {
    exitCode: child.status,
    stdout: child.stdout.split("\n").filter(Boolean),
    stderr: child.stderr.split("\n").filter(Boolean),
    requests: lines.map(normalizeEntry)
  };
}
