/* MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md) */
// MAZKION 일일 기술 학습 교재 생성기 (Node.js 20+) — 실행 흐름과 외부 호출
//
// 무엇을: 전날 밤 night/YYYY-MM-DD 브랜치의 코드 변경으로 학습 교재를 하루 1개 만들어
//         reports 브랜치 learning/YYYY-MM-DD.md에 저장하고, PR(없으면 이슈)에 알린다.
// 안전:   night 코드는 실행하지 않고 API로 읽기만 한다. 외부 AI 전송 전·저장 전에 민감정보를 검사한다.
//         모델 출력은 Markdown 파일과 댓글로만 쓰이고, 출력에 따라 실행되는 동작은 없다.
// 설명:   .github/scripts/DAILY_LEARNING.md · 순수 함수: learning/lib.mjs · 민감정보: learning/secrets.mjs

import {
  CONFIG, koreaTimestamp, resolveTargetDate, previousDates, hasCodeChanges, parseLearningPoints,
  pickCoreFiles, numberLines, collectOtherPatches, clip, fitPrompt, buildDocument, buildNotice
} from "./learning/lib.mjs";
import { scanSources, describeFindings } from "./learning/secrets.mjs";

// ==========================================
// 1. 환경과 의존성(시험에서 fetch·sleep·now를 바꿔 끼운다)
// ==========================================

export function readEnv(e = process.env) {
  return {
    openaiKey: e.OPENAI_API_KEY,
    token: e.GITHUB_TOKEN,
    repo: e.GITHUB_REPOSITORY,
    inputDate: e.INPUT_DATE,
    force: e.INPUT_FORCE === "true",
    dryRun: e.MZK_DRY_RUN === "1",
    issue: e.MZK_LEARNING_ISSUE || CONFIG.defaultIssue,
    model: e.MZK_LEARNING_MODEL || CONFIG.defaultModel,
    maxTokens: Number(e.MZK_LEARNING_MAX_TOKENS || CONFIG.defaultMaxTokens),
    summaryFile: e.GITHUB_STEP_SUMMARY
  };
}

const enc = p => p.split("/").map(encodeURIComponent).join("/");
const encRef = r => encodeURIComponent(r);

// ==========================================
// 2. GitHub · OpenAI 클라이언트
// ==========================================

export function makeGithub(cfg, fetchFn) {
  return async function github(path, options = {}) {
    const { allowNotFound = false, ...rest } = options;
    const res = await fetchFn(`https://api.github.com/repos/${cfg.repo}${path}`, {
      ...rest,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": CONFIG.apiVersion,
        "Content-Type": "application/json"
      }
    });
    const body = await res.text();
    if (res.status === 404 && allowNotFound) return null;
    if (!res.ok) throw new Error(`GitHub API ${res.status} ${path.split("?")[0]}: ${body.slice(0, 300)}`);
    return body ? JSON.parse(body) : null;
  };
}

/** OpenAI 호출: 일시 오류(429·5xx·네트워크)만 정해진 간격으로 재시도. 불완전한 응답은 실패로 본다. */
export async function callOpenAI(cfg, prompt, { fetchFn, sleep }) {
  let lastError;
  for (let attempt = 0; attempt <= CONFIG.retryDelaysMs.length; attempt++) {
    if (attempt > 0) await sleep(CONFIG.retryDelaysMs[attempt - 1]);
    let res;
    try {
      res = await fetchFn("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: cfg.model, input: prompt, max_output_tokens: cfg.maxTokens })
      });
    } catch (error) { lastError = new Error(`OpenAI 연결 실패(재시도 가능): ${error.message}`); continue; }
    const data = await res.json().catch(() => ({}));
    if (CONFIG.retryStatuses.includes(res.status)) { lastError = new Error(`OpenAI ${res.status}(재시도 가능)`); continue; }
    if (!res.ok) throw new Error(`OpenAI ${res.status}(재시도 불가): ${data.error?.message || "unknown"}`);
    const text = (data.output_text || (data.output || [])
      .flatMap(i => i.content || []).filter(c => c.type === "output_text").map(c => c.text).join("")).trim();
    if (!text || data.status !== "completed") {
      throw new Error(`OpenAI 응답 불완전(status=${data.status}) — 출력 상한 MZK_LEARNING_MAX_TOKENS 확인. 불완전한 교재는 저장하지 않음`);
    }
    return { text, usage: data.usage || {}, attempts: attempt + 1 };
  }
  throw new Error(`${lastError.message} — ${CONFIG.retryDelaysMs.length}회 재시도 후 실패`);
}

// ==========================================
// 3. 저장소 조회
// ==========================================

async function learningFile(gh, date) {
  return gh(`/contents/${enc(`${CONFIG.learningDir}/${date}.md`)}?ref=${encRef(CONFIG.reportsBranch)}`, { allowNotFound: true });
}

/** 대상 브랜치의 변경 파일. 브랜치가 없으면 null. */
async function loadChanges(gh, branch) {
  const exists = await gh(`/branches/${encRef(branch)}`, { allowNotFound: true });
  if (!exists) return null;
  const repo = await gh("");
  const cmp = await gh(`/compare/${encRef(`${repo.default_branch}...${branch}`)}`);
  return { files: cmp.files || [], baseSha: cmp.merge_base_commit?.sha || cmp.base_commit?.sha };
}

async function findNightPr(gh, cfg, branch) {
  const owner = cfg.repo.split("/")[0];
  const prs = await gh(`/pulls?state=all&head=${encRef(`${owner}:${branch}`)}&per_page=5`);
  return Array.isArray(prs) && prs.length > 0 ? prs[0] : null;
}

async function readFileAt(gh, path, ref) {
  const data = await gh(`/contents/${enc(path)}?ref=${encRef(ref)}`);
  return Buffer.from(data.content || "", "base64").toString("utf8");
}

/** 최근 며칠 중 '코드 변경은 있는데 교재가 없는' 날짜(예약 누락·실패 감지). */
export async function findMissingDates(gh, target) {
  const missing = [];
  for (const d of previousDates(target)) {
    if (await learningFile(gh, d)) continue;
    const changes = await loadChanges(gh, `${CONFIG.nightPrefix}${d}`);
    if (changes && hasCodeChanges(changes.files)) missing.push(d);
  }
  return missing.sort();
}

// ==========================================
// 4. 쓰기(저장·알림)
// ==========================================

async function ensureReportsBranch(gh, baseSha) {
  const ref = await gh(`/git/ref/heads/${enc(CONFIG.reportsBranch)}`, { allowNotFound: true });
  if (ref) return;
  try {
    await gh("/git/refs", { method: "POST", body: JSON.stringify({ ref: `refs/heads/${CONFIG.reportsBranch}`, sha: baseSha }) });
  } catch (error) {
    if (!(await gh(`/git/ref/heads/${enc(CONFIG.reportsBranch)}`, { allowNotFound: true }))) throw error;
  }
}

async function saveLearning(gh, cfg, date, content, existingSha) {
  const path = `${CONFIG.learningDir}/${date}.md`;
  await gh(`/contents/${enc(path)}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `Archive MAZKION daily learning: ${path}`,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch: CONFIG.reportsBranch,
      ...(existingSha ? { sha: existingSha } : {})
    })
  });
  return `https://github.com/${cfg.repo}/blob/${CONFIG.reportsBranch}/${path}`;
}

/** PR이 있으면 PR에, 없으면 지정 이슈에 알린다. 같은 날짜·상태 댓글이 이미 있으면 다시 달지 않는다. */
async function notify(gh, cfg, pr, body) {
  const number = pr ? pr.number : cfg.issue;
  const marker = body.split("\n")[0];
  const comments = await gh(`/issues/${number}/comments?per_page=100`, { allowNotFound: true }) || [];
  if (comments.some(c => (c.body || "").startsWith(marker))) return { number, duplicated: true };
  await gh(`/issues/${number}/comments`, { method: "POST", body: JSON.stringify({ body }) });
  return { number, duplicated: false };
}

// ==========================================
// 5. 실행 흐름
// ==========================================

/** 교재 입력 자료를 모은다(읽기만). */
async function prepare(gh, cfg, date, changes) {
  const branch = `${CONFIG.nightPrefix}${date}`;
  const pr = await findNightPr(gh, cfg, branch);
  const coreNames = pickCoreFiles(changes.files, parseLearningPoints(pr?.body));
  const core = [];
  const raw = [];
  for (const path of coreNames) {
    const source = await readFileAt(gh, path, branch);
    raw.push({ name: path, text: source });
    core.push({ path, ...numberLines(source) });
  }
  const others = collectOtherPatches(changes.files, coreNames);
  const prBody = clip(pr?.body, CONFIG.maxBodyChars);
  const sources = [{ name: "PR 본문", text: prBody }, ...raw,
    ...changes.files.filter(f => !coreNames.includes(f.filename)).map(f => ({ name: `${f.filename}(패치)`, text: f.patch }))];
  return { branch, pr, core, coreNames, others, prBody, sources };
}

/** 한 번 실행. 반환 status: skipped | dry-run | ok | blocked | failed */
export async function run({ cfg, fetchFn = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), now = new Date() }) {
  const gh = makeGithub(cfg, fetchFn);
  const date = resolveTargetDate(cfg.inputDate, now);
  const startedAt = koreaTimestamp(now);
  const base = { date, startedAt };
  const changes = await loadChanges(gh, `${CONFIG.nightPrefix}${date}`);
  if (!changes) return { ...base, status: "skipped", reason: "night 브랜치 없음(그날 밤 개발 없음)" };
  if (!hasCodeChanges(changes.files)) return { ...base, status: "skipped", reason: "코드 변경 없음(문서·잠금 커밋만) — API 호출 안 함" };
  const existing = await learningFile(gh, date);
  if (existing && !cfg.force) return { ...base, status: "skipped", reason: "이미 교재 있음(다시 만들려면 force)" };

  const p = await prepare(gh, cfg, date, changes);
  const missing = await findMissingDates(gh, date);
  const fail = async (status, detail) => {
    let reason = detail;
    if (!cfg.dryRun) {
      try { await notify(gh, cfg, p.pr, buildNotice({ date, missing, status, detail })); } catch (e) { reason += `\n(알림 실패: ${e.message})`; }
    }
    return { ...base, status, reason, missing };
  };
  const inputFindings = scanSources(p.sources);
  if (inputFindings.length) return fail("blocked", `외부 AI 전송 전 민감정보 의심 ${inputFindings.length}건 — 전송하지 않았습니다.\n${describeFindings(inputFindings)}`);
  const fitted = fitPrompt({ date, branch: p.branch, prTitle: p.pr?.title, prBody: p.prBody, core: p.core, others: p.others.text });
  if (!fitted) return fail("failed", "입력이 전체 상한을 넘어 생성을 중단했습니다(핵심 파일 분량 확인).");
  const omitted = fitted.droppedOthers ? ["(그 밖의 변경 파일 전부)"] : p.others.omitted;
  if (cfg.dryRun) return { ...base, status: "dry-run", coreNames: p.coreNames, promptChars: fitted.prompt.length, omitted, missing };

  let result;
  try { result = await callOpenAI(cfg, fitted.prompt, { fetchFn, sleep }); } catch (error) { return fail("failed", error.message); }
  const outFindings = scanSources([{ name: "생성된 교재", text: result.text }]);
  if (outFindings.length) return fail("blocked", `생성된 교재에서 민감정보 의심 ${outFindings.length}건 — 저장하지 않았습니다.\n${describeFindings(outFindings)}`);

  const doc = buildDocument({ date, branch: p.branch, prUrl: p.pr?.html_url, core: p.core, omitted, model: cfg.model, ...result, generatedAt: koreaTimestamp(new Date()) });
  await ensureReportsBranch(gh, changes.baseSha);
  const url = await saveLearning(gh, cfg, date, doc, existing?.sha);
  let notifiedTo = null;
  let reason;
  try { notifiedTo = (await notify(gh, cfg, p.pr, buildNotice({ date, url, coreNames: p.coreNames, missing, status: "ok" }))).number; }
  catch (e) { reason = `교재는 저장됨, 알림 실패: ${e.message}`; }
  return { ...base, status: "ok", url, notifiedTo, reason, usage: result.usage, attempts: result.attempts, missing };
}

export async function writeSummary(cfg, result) {
  const lines = [
    "## MAZKION 일일 학습 교재 실행 기록",
    `- 대상 날짜: ${result.date ?? "?"} · 실행 시각: ${result.startedAt ?? "?"} · 상태: **${result.status}**`,
    result.reason ? `- 사유: ${result.reason.split("\n")[0]}` : "",
    result.url ? `- 교재: ${result.url}` : "",
    result.usage ? `- 토큰: 입력 ${result.usage.input_tokens ?? "?"} / 출력 ${result.usage.output_tokens ?? "?"} (시도 ${result.attempts}회)` : "",
    result.promptChars ? `- (점검 모드) 핵심 파일: ${result.coreNames.join(", ")} · 입력 ${result.promptChars}자` : "",
    result.missing?.length ? `- 누락된 날짜: ${result.missing.join(", ")}` : ""
  ].filter(Boolean);
  console.log(lines.join("\n"));
  if (cfg.summaryFile) await (await import("node:fs/promises")).appendFile(cfg.summaryFile, `${lines.join("\n")}\n`);
}

async function cli() {
  const cfg = readEnv();
  const required = { GITHUB_TOKEN: cfg.token, GITHUB_REPOSITORY: cfg.repo, ...(cfg.dryRun ? {} : { OPENAI_API_KEY: cfg.openaiKey }) };
  for (const [k, v] of Object.entries(required)) if (!v) throw new Error(`${k}가 없습니다.`);
  const result = await run({ cfg });
  await writeSummary(cfg, result);
  // 막힘·실패는 워크플로를 실패로 끝내 GitHub 실패 알림이 가게 한다.
  if (result.status === "blocked" || result.status === "failed") process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  cli().catch(error => { console.error(error.message); process.exit(1); });
}
