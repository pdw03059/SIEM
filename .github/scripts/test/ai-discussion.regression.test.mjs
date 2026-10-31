// MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md)
/*
 * ai-discussion.regression.test.mjs — 기존 AI 리뷰 스크립트의 동작을 고정하는 회귀 시험 (1단계)
 *
 * 실행: node --test .github/scripts/test/
 * 정답 갱신(의도적으로 동작을 바꿨을 때만): UPDATE_GOLDEN=1 node --test .github/scripts/test/
 *
 * 시험 네 겹:
 *   (가) 원본 보존본 무결성: test/legacy/ai-discussion.v0.mjs의 SHA-256이 1단계에서 기록한
 *        원본 해시(golden/TARGET_SHA256)와 같은지. 2단계부터 진입 파일은 바뀌므로 보존본을 확인한다.
 *   (나) 정답 비교: 시나리오별 종료 코드·호출 순서·요청 내용이 golden/*.json과 같은지
 *        - 원본 보존본 결과 = 정답 파일 → 정답 파일이 몰래 고쳐지지 않았음을 확인
 *        - 신규 코드 결과 = 정답 파일, 그리고 신규 = 원본(글자 단위) → 모듈 분리 후 동작 동일
 *        시각(KST 19:00:00)·실행 번호(12345)는 두 실행 모두 같은 값으로 고정하므로 지우지 않고 비교한다.
 *   (다) 핵심 성질 확인: 정답 파일과 별개로 "무엇이 일어나야/일어나면 안 되는지"를 직접 단언
 *        → 정답 파일을 잘못 갱신해도 핵심 성질이 깨지면 실패한다.
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS } from "./harness/scenarios.mjs";
import { runScenario, LEGACY } from "./harness/run-scenario.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.join(here, "golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

/* ---- 공통 도우미 ---- */
const results = new Map(); // "대상:시나리오 이름" → 실행 결과(같은 실행을 두 번 하지 않기 위해)
function run(name, target) {
  const key = `${target ?? "new"}:${name}`;
  if (!results.has(key)) {
    const s = SCENARIOS.find(x => x.name === name);
    results.set(key, target ? runScenario(s, target) : runScenario(s));
  }
  return results.get(key);
}
const result = name => run(name); // 신규 코드 결과(핵심 성질 시험이 쓰는 기본값)
const legacyResult = name => run(name, LEGACY); // 원본 보존본 결과
const calls = r => r.requests.map(q => `${q.method} ${q.matched}`); // 호출 순서 요약
const llmCalls = r => r.requests.filter(q => /openai|anthropic/.test(q.url));
const writes = r => r.requests.filter(q => q.method !== "GET" && !/openai|anthropic/.test(q.url));

/* ---- (가) 대상 파일 무결성 ---- */
test("원본 보존본이 1단계 원본과 글자 단위로 같다 (SHA-256)", () => {
  const expected = fs.readFileSync(path.join(GOLDEN_DIR, "TARGET_SHA256"), "utf8").trim();
  const actual = crypto.createHash("sha256").update(fs.readFileSync(LEGACY)).digest("hex");
  assert.equal(actual, expected, "test/legacy/ai-discussion.v0.mjs가 바뀌었습니다. 보존본은 절대 수정하지 않습니다.");
});

/* ---- (나) 정답 파일 비교: 시나리오마다 하나 ---- */
for (const s of SCENARIOS) {
  test(`정답 비교: ${s.name} — ${s.description}`, () => {
    const r = result(s.name);
    const file = path.join(GOLDEN_DIR, `${s.name}.json`);
    const snapshot = { description: s.description, ...r };
    if (UPDATE || !fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(snapshot, null, 2) + "\n");
    }
    assert.deepEqual(snapshot, JSON.parse(fs.readFileSync(file, "utf8")));
  });

  test(`원본 보존본 = 정답: ${s.name}`, () => {
    const file = path.join(GOLDEN_DIR, `${s.name}.json`);
    const snapshot = { description: s.description, ...legacyResult(s.name) };
    assert.deepEqual(snapshot, JSON.parse(fs.readFileSync(file, "utf8")), "정답 파일이 원본 결과와 다릅니다(정답 파일 변조 의심).");
  });

  test(`신규 = 원본(글자 단위): ${s.name}`, () => {
    // JSON 문자열로 바꿔 비교: 요청 본문·보고서·출력 줄이 한 글자라도 다르면 실패
    assert.equal(JSON.stringify(result(s.name)), JSON.stringify(legacyResult(s.name)));
  });
}

/* ---- (다) 핵심 성질 ---- */
test("정상: 호출 순서 = PR → 파일 → GPT → Claude → GPT → 브랜치 확인 → 저장 2 → 댓글", () => {
  const r = result("01-normal");
  assert.equal(r.exitCode, 0);
  assert.deepEqual(calls(r), [
    "GET /pulls/7", "GET /pulls/7/files",
    "POST api.openai.com", "POST api.anthropic.com", "POST api.openai.com",
    "GET /git/ref/heads/reports",
    "PUT /contents/reports/", "PUT /contents/reports/",
    "POST /issues/1/comments"
  ]);
});

test("정상: 모델·출력 한도·저장 경로·브랜치", () => {
  const r = result("01-normal");
  const [gpt, claude, learn] = llmCalls(r);
  assert.equal(gpt.body.model, "gpt-6-luna");
  assert.equal(gpt.body.max_output_tokens, 5000);
  assert.equal(claude.body.model, "claude-sonnet-5");
  assert.equal(claude.body.max_tokens, 5000);
  assert.equal(learn.body.max_output_tokens, 8000);
  const puts = r.requests.filter(q => q.method === "PUT");
  assert.match(puts[0].url, /reports\/2026-10-31\/PR-007-review-20261031-190000-run12345\.md$/);
  assert.match(puts[1].url, /reports\/2026-10-31\/PR-007-learning-20261031-190000-run12345\.md$/);
  assert.ok(puts.every(p => p.body.branch === "reports"));
});

test("정상: 같은 diff가 AI 3회 호출 모두에 들어간다(비용 기준선)", () => {
  const r = result("01-normal");
  const prompts = llmCalls(r).map(q => q.body.input ?? q.body.messages[0].content);
  assert.equal(prompts.length, 3);
  assert.ok(prompts.every(p => p.includes("+int a = 0;")));
});

test("정상: 앞 단계 결과가 다음 단계 입력으로 전달된다", () => {
  const r = result("01-normal");
  const [, claude, learn] = llmCalls(r);
  assert.ok(claude.body.messages[0].content.includes("GPT-REVIEW-TEXT"));
  assert.ok(learn.body.input.includes("GPT-REVIEW-TEXT"));
  assert.ok(learn.body.input.includes("CLAUDE-ANSWER-TEXT"));
  const comment = r.requests.at(-1).body.body;
  for (const t of ["GPT-REVIEW-TEXT", "CLAUDE-ANSWER-TEXT", "LEARNING-TEXT"]) assert.ok(comment.includes(t));
});

test("키 값은 요청 기록·출력 어디에도 평문으로 남지 않는다(가짜 키 기준)", () => {
  for (const s of SCENARIOS) {
    const text = JSON.stringify(result(s.name));
    for (const k of ["test-openai-key", "test-anthropic-key", "test-github-token"]) {
      assert.ok(!text.includes(k), `${s.name}: ${k} 노출`);
    }
  }
});

test("reports 브랜치가 없으면 PR base SHA로 만든다", () => {
  const r = result("02-reports-branch-missing");
  assert.equal(r.exitCode, 0);
  const create = r.requests.find(q => q.method === "POST" && q.url.endsWith("/git/refs"));
  assert.deepEqual(create.body, { ref: "refs/heads/reports", sha: "0000000000000000000000000000000000000abc" });
});

test("브랜치 동시 생성(422 후 존재) → 계속 진행", () => {
  assert.equal(result("03-reports-branch-race").exitCode, 0);
});

test("AI 응답 실패·잘림은 즉시 실패하고 아무것도 저장·게시하지 않는다", () => {
  const expectLlmCalls = { "04-gpt-review-incomplete": 1, "05-claude-max-tokens": 2, "06-learning-incomplete": 3, "13-openai-http-error": 1 };
  for (const [name, n] of Object.entries(expectLlmCalls)) {
    const r = result(name);
    assert.equal(r.exitCode, 1, name);
    assert.equal(llmCalls(r).length, n, `${name}: AI 호출 횟수`);
    assert.equal(writes(r).length, 0, `${name}: 저장·게시가 없어야 함`);
  }
});

test("입력 검증 실패는 요청을 하나도 보내지 않는다", () => {
  for (const name of ["10-missing-key", "11-invalid-pr-number"]) {
    const r = result(name);
    assert.equal(r.exitCode, 1);
    assert.equal(r.requests.length, 0, name);
  }
});

test("변경 파일 0개 → AI 호출 없이 실패", () => {
  const r = result("07-no-files");
  assert.equal(r.exitCode, 1);
  assert.equal(llmCalls(r).length, 0);
});

test("diff 3만 자 초과 → 잘림 표시", () => {
  const r = result("08-diff-truncated");
  assert.equal(r.exitCode, 0);
  assert.ok(llmCalls(r)[0].body.input.includes("[DIFF TRUNCATED"));
});

test("파일 목록은 per_page=100 한 번만 요청(다음 페이지 없음)", () => {
  const r = result("09-hundred-files-no-paging");
  const fileReqs = r.requests.filter(q => q.url.includes("/files"));
  assert.equal(fileReqs.length, 1);
  assert.match(fileReqs[0].url, /per_page=100$/);
});

test("Issue 댓글 실패 → 실패 종료, 그러나 reports 파일 2개는 이미 저장됨(부분 완료 상태)", () => {
  const r = result("12-issue-comment-fails");
  assert.equal(r.exitCode, 1);
  assert.equal(r.requests.filter(q => q.method === "PUT").length, 2);
});

test("patch 없는 파일은 대체 문구로 진행", () => {
  const r = result("14-patch-missing");
  assert.equal(r.exitCode, 0);
  assert.ok(llmCalls(r)[0].body.input.includes("[Patch unavailable: binary or large file]"));
});

test("실패 시 표준 오류에는 메시지 한 줄만 남고, 실패 단계 이름은 남지 않는다(현재 한계 기록)", () => {
  const r = result("05-claude-max-tokens");
  assert.ok(r.stderr.some(l => l.startsWith("MAZKION REVIEW FAILED: Claude discussion was incomplete.")));
});
