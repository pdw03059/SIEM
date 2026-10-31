/* MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md) */
// 전체 실행 흐름 시험 — 가짜 GitHub·OpenAI 서버(fetch 주입)로 실제 네트워크·비용 없이 검증한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../daily-learning.mjs";
import { CONFIG } from "./lib.mjs";

const REPO = "owner/repo";
const NOW = new Date("2026-11-01T23:10:00Z"); // 11-02 08:10 KST → 대상 2026-11-01
const TARGET = "2026-11-01";
const b64 = s => Buffer.from(s, "utf8").toString("base64");

/** 가짜 서버: 상태(state)를 들고 GitHub·OpenAI 요청에 응답하고, 모든 요청을 기록한다. */
function fakeServer(state) {
  const calls = [];
  const reply = (status, body) => ({ ok: status < 400, status, text: async () => (body === undefined ? "" : JSON.stringify(body)), json: async () => body ?? {} });
  async function fetchFn(url, opts = {}) {
    const method = opts.method || "GET";
    calls.push({ method, url, body: opts.body });
    if (url.startsWith("https://api.openai.com")) {
      const next = state.openai.shift();
      if (next instanceof Error) throw next;
      return reply(next.status, next.body);
    }
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname.replace(`/repos/${REPO}`, ""));
    const ref = u.searchParams.get("ref");
    if (method === "GET" && path === "") return reply(200, { default_branch: "main" });
    if (method === "GET" && path.startsWith("/branches/")) {
      const name = path.slice("/branches/".length);
      return state.branches[name] ? reply(200, { name }) : reply(404, { message: "Not Found" });
    }
    if (method === "GET" && path.startsWith("/compare/")) {
      const name = path.split("...")[1];
      return reply(200, { files: state.branches[name], merge_base_commit: { sha: "base123" } });
    }
    if (method === "GET" && path === "/pulls") return reply(200, state.pr ? [state.pr] : []);
    if (method === "GET" && path.startsWith("/contents/")) {
      const file = path.slice("/contents/".length);
      const content = state.files[`${ref}:${file}`];
      return content === undefined ? reply(404, {}) : reply(200, { content: b64(content), sha: "filesha" });
    }
    if (method === "GET" && path === `/git/ref/heads/${CONFIG.reportsBranch}`) return state.reports ? reply(200, {}) : reply(404, {});
    if (method === "POST" && path === "/git/refs") { state.reports = true; return reply(201, {}); }
    if (method === "PUT" && path.startsWith("/contents/")) {
      const b = JSON.parse(opts.body);
      state.files[`${b.branch}:${path.slice("/contents/".length)}`] = Buffer.from(b.content, "base64").toString("utf8");
      return reply(201, {});
    }
    const m = path.match(/^\/issues\/(\d+)\/comments$/);
    if (m && method === "GET") return reply(200, state.comments[m[1]] || []);
    if (m && method === "POST") { (state.comments[m[1]] ||= []).push(JSON.parse(opts.body)); return reply(201, {}); }
    return reply(500, { message: `unhandled ${method} ${path}` });
  }
  return { fetchFn, calls };
}

const okAI = text => ({ status: 200, body: { status: "completed", output_text: text, usage: { input_tokens: 100, output_tokens: 50 } } });
const baseState = (over = {}) => ({
  branches: { [`night/${TARGET}`]: [{ filename: "src/udp.c", status: "added", additions: 10, patch: "+int x;" }, { filename: "PROGRESS.md", status: "modified", additions: 1 }] },
  files: { [`night/${TARGET}:src/udp.c`]: "int x; // 정수\n" },
  pr: null, comments: {}, reports: false, openai: [okAI("# 1. 교재 본문")], ...over
});
const cfg = (over = {}) => ({ repo: REPO, token: "t", openaiKey: "k", issue: "1", model: "m", maxTokens: 100, force: false, dryRun: false, ...over });
const go = (state, c = cfg()) => { const s = fakeServer(state); return run({ cfg: c, fetchFn: s.fetchFn, sleep: async () => {}, now: NOW }).then(r => ({ r, s, state })); };
const aiCalls = s => s.calls.filter(c => c.url.startsWith("https://api.openai.com")).length;

test("브랜치가 없으면 건너뜀, OpenAI 호출 0", async () => {
  const { r, s } = await go(baseState({ branches: {} }));
  assert.equal(r.status, "skipped");
  assert.equal(aiCalls(s), 0);
});

test("코드 변경이 없으면(문서·잠금 커밋만) 건너뜀, 비용 0", async () => {
  const { r, s } = await go(baseState({ branches: { [`night/${TARGET}`]: [{ filename: "PROGRESS.md", status: "modified" }] } }));
  assert.equal(r.status, "skipped");
  assert.equal(aiCalls(s), 0);
});

test("이미 교재가 있으면 건너뜀, force면 다시 만들고 sha로 덮어씀", async () => {
  const exists = { [`reports:learning/${TARGET}.md`]: "old", [`night/${TARGET}:src/udp.c`]: "int x;\n" };
  const a = await go(baseState({ files: { ...exists } }));
  assert.equal(a.r.status, "skipped");
  const b = await go(baseState({ files: { ...exists }, reports: true }), cfg({ force: true }));
  assert.equal(b.r.status, "ok");
  const put = b.s.calls.find(c => c.method === "PUT");
  assert.equal(JSON.parse(put.body).sha, "filesha");
});

test("성공(PR 있음): reports 브랜치 생성·저장·PR 댓글, 슬래시 브랜치는 인코딩해 요청", async () => {
  const pr = { number: 7, title: "night", html_url: "https://x/pr/7", body: "## 오늘의 학습 포인트\n- `src/udp.c`" };
  const { r, s, state } = await go(baseState({ pr }));
  assert.equal(r.status, "ok");
  assert.equal(state.reports, true);
  assert.match(state.files[`reports:learning/${TARGET}.md`], /교재 본문/);
  assert.match(state.files[`reports:learning/${TARGET}.md`], /전체 1줄/);
  assert.equal(state.comments["7"].length, 1);
  assert.ok(s.calls.some(c => c.url.includes(`/branches/night%2F${TARGET}`)));
  assert.ok(s.calls.some(c => c.url.includes(`/compare/main...night%2F${TARGET}`)));
});

test("PR이 없으면 이슈 #1에 알림", async () => {
  const { r, state } = await go(baseState());
  assert.equal(r.status, "ok");
  assert.equal(r.notifiedTo, "1");
  assert.match(state.comments["1"][0].body, new RegExp(`${CONFIG.commentMarker}:${TARGET}:ok`));
});

test("같은 날짜·상태 알림이 이미 있으면 댓글을 다시 달지 않음", async () => {
  const marker = `<!-- ${CONFIG.commentMarker}:${TARGET}:ok -->`;
  const { state } = await go(baseState({ comments: { 1: [{ body: `${marker}\n이전 알림` }] } }));
  assert.equal(state.comments["1"].length, 1);
});

test("입력에 민감정보 의심이 있으면 OpenAI로 보내지 않고 실패 처리, 알림에 값 없음", async () => {
  const fakeIp = ["10", "20", "30", "40"].join(".");
  const st = baseState({ files: { [`night/${TARGET}:src/udp.c`]: `const char *h = "${fakeIp}";\n` } });
  const { r, s, state } = await go(st);
  assert.equal(r.status, "blocked");
  assert.equal(aiCalls(s), 0);
  assert.ok(!state.files[`reports:learning/${TARGET}.md`]);
  const note = state.comments["1"][0].body;
  assert.match(note, /IP 주소.*src\/udp\.c.*1번째 줄/);
  assert.ok(!note.includes(fakeIp));
});

test("생성된 교재에 민감정보 의심이 있으면 저장하지 않음", async () => {
  const leaked = ["ghp_", "L".repeat(30)].join("");
  const { r, state } = await go(baseState({ openai: [okAI(`토큰 예: ${leaked}`)] }));
  assert.equal(r.status, "blocked");
  assert.ok(!state.files[`reports:learning/${TARGET}.md`]);
});

test("OpenAI 일시 오류(500·연결 실패)는 재시도 후 성공", async () => {
  const { r, s } = await go(baseState({ openai: [{ status: 500, body: {} }, new Error("ECONNRESET"), okAI("본문")] }));
  assert.equal(r.status, "ok");
  assert.equal(r.attempts, 3);
  assert.equal(aiCalls(s), 3);
});

test("OpenAI 재시도 불가 오류(401)는 즉시 실패, 저장 없음", async () => {
  const { r, s, state } = await go(baseState({ openai: [{ status: 401, body: { error: { message: "bad key" } } }] }));
  assert.equal(r.status, "failed");
  assert.match(r.reason, /재시도 불가/);
  assert.equal(aiCalls(s), 1);
  assert.ok(!state.files[`reports:learning/${TARGET}.md`]);
});

test("출력 상한 초과로 불완전한 응답은 저장하지 않음", async () => {
  const { r, state } = await go(baseState({ openai: [{ status: 200, body: { status: "incomplete", output_text: "반쯤" } }] }));
  assert.equal(r.status, "failed");
  assert.match(r.reason, /불완전/);
  assert.ok(!state.files[`reports:learning/${TARGET}.md`]);
});

test("재시도를 다 써도 실패하면 실패 처리", async () => {
  const { r, s } = await go(baseState({ openai: [{ status: 503 }, { status: 503 }, { status: 503 }] }));
  assert.equal(r.status, "failed");
  assert.equal(aiCalls(s), CONFIG.retryDelaysMs.length + 1);
});

test("최근 7일 중 코드 변경은 있는데 교재가 없는 날짜를 누락으로 보고", async () => {
  const st = baseState();
  st.branches["night/2026-10-30"] = [{ filename: "src/old.c", status: "added", additions: 1 }];
  st.branches["night/2026-10-29"] = [{ filename: "PROGRESS.md", status: "modified" }];
  st.branches["night/2026-10-28"] = [{ filename: "src/done.c", status: "added", additions: 1 }];
  st.files["reports:learning/2026-10-28.md"] = "있음";
  const { r, state } = await go(st);
  assert.deepEqual(r.missing, ["2026-10-30"]);
  assert.match(state.comments["1"][0].body, /누락된 날짜.*2026-10-30/);
});

test("점검 모드(DRY_RUN): 읽기만 하고 OpenAI·쓰기 요청 없음", async () => {
  const { r, s } = await go(baseState(), cfg({ dryRun: true }));
  assert.equal(r.status, "dry-run");
  assert.equal(aiCalls(s), 0);
  assert.ok(s.calls.every(c => c.method === "GET"));
  assert.deepEqual(r.coreNames, ["src/udp.c"]);
});
