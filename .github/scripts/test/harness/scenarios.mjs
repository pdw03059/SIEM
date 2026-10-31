// MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md)
/*
 * scenarios.mjs — 회귀 시험 시나리오 정의
 *
 * 무엇: 시나리오마다 "가짜 GitHub/OpenAI/Claude 응답 목록"과 "환경 변수"를 만든다.
 * 왜: 기존 스크립트가 정상·오류 상황에서 정확히 어떤 요청을 어떤 순서로 보내는지
 *     기록해 두고(정답 파일), 2단계 모듈 분리 뒤에도 같은지 비교하기 위해서다.
 * 확장하는 법: SCENARIOS 배열에 { name, description, env, routes } 하나를 추가한다.
 *     routes는 기본 응답(baseRoutes)을 고쳐 쓰는 함수로 만들면 짧게 쓸 수 있다.
 * 주의: 모든 데이터는 가짜다. 실제 고객 정보·키·로그 원문을 넣지 않는다.
 */

/* ---- 1. 공통 가짜 데이터 ---- */
export const PR = 7; // 시험용 PR 번호(실제 PR 아님)

const prJson = {
  title: "test: sample change",
  html_url: "https://github.com/pdw03059/SIEM/pull/7",
  body: "sample PR body",
  head: { ref: "ai/sample" },
  base: { ref: "main", sha: "0000000000000000000000000000000000000abc" }
};

// 변경 파일 하나(작은 C 코드 patch)
export function fileEntry(i = 0, patch = "@@ -1 +1 @@\n-int a;\n+int a = 0;") {
  return {
    filename: `stage1/src/sample${i}.c`,
    status: "modified",
    additions: 1,
    deletions: 1,
    patch
  };
}

// OpenAI Responses API 성공 응답
export function openaiOk(text, usage = { input_tokens: 100, output_tokens: 50 }) {
  return { status: "completed", output_text: text, usage };
}

// Claude Messages API 성공 응답
export function claudeOk(text, usage = { input_tokens: 120, output_tokens: 60 }) {
  return { content: [{ type: "text", text }], stop_reason: "end_turn", usage };
}

/* ---- 2. 정상 흐름의 기본 응답 목록 ----
 * 순서가 중요하다: 주소에 포함 여부로 찾으므로 더 구체적인 주소를 앞에 둔다. */
export function baseRoutes({ files = [fileEntry()], reportsExists = true } = {}) {
  return [
    { method: "GET", match: `/pulls/${PR}/files`, json: files },
    { method: "GET", match: `/pulls/${PR}`, json: prJson },
    { method: "POST", match: "api.openai.com", times: 1, json: openaiOk("GPT-REVIEW-TEXT") },
    { method: "POST", match: "api.anthropic.com", json: claudeOk("CLAUDE-ANSWER-TEXT") },
    {
      method: "POST", match: "api.openai.com", times: 1,
      json: openaiOk("LEARNING-TEXT", { input_tokens: 300, output_tokens: 200 })
    },
    reportsExists
      ? { method: "GET", match: "/git/ref/heads/reports", json: { ref: "refs/heads/reports" } }
      : { method: "GET", match: "/git/ref/heads/reports", status: 404, json: { message: "Not Found" } },
    { method: "POST", match: "/git/refs", status: 201, json: { ref: "refs/heads/reports" } },
    { method: "PUT", match: "/contents/reports/", status: 201, json: { content: {} } },
    { method: "POST", match: "/issues/1/comments", status: 201, json: { id: 1 } }
  ];
}

/* ---- 3. 기본 환경 변수(가짜 키) ---- */
export function baseEnv(extra = {}) {
  return {
    OPENAI_API_KEY: "test-openai-key",
    ANTHROPIC_API_KEY: "test-anthropic-key",
    GITHUB_TOKEN: "test-github-token",
    GITHUB_REPOSITORY: "pdw03059/SIEM",
    PR_NUMBER: String(PR),
    ISSUE_NUMBER: "1",
    GITHUB_RUN_ID: "12345",
    ...extra
  };
}

// 기본 응답 목록에서 특정 규칙 하나만 바꿔 끼우는 도우미
function replaceRoute(routes, index, route) {
  const copy = routes.slice();
  copy[index] = route;
  return copy;
}

/* ---- 4. 시나리오 목록 ---- */
const longPatch = "+" + "x".repeat(31000); // 3만 자 제한을 넘기는 patch
const many = Array.from({ length: 100 }, (_, i) => fileEntry(i));

export const SCENARIOS = [
  {
    name: "01-normal",
    description: "정상: reports 브랜치 있음 → GPT 리뷰, Claude 답변, GPT 교재, 파일 2개 저장, Issue 댓글",
    env: baseEnv(),
    routes: baseRoutes()
  },
  {
    name: "02-reports-branch-missing",
    description: "reports 브랜치 없음 → PR base SHA로 새로 만든 뒤 정상 진행",
    env: baseEnv(),
    routes: baseRoutes({ reportsExists: false })
  },
  {
    name: "03-reports-branch-race",
    description: "브랜치 생성 실패(422)했지만 다시 보니 이미 있음(동시 생성) → 계속 진행",
    env: baseEnv(),
    routes: (() => {
      const r = baseRoutes({ reportsExists: false });
      r[5] = { ...r[5], times: 1 }; // 첫 확인은 404
      r.splice(6, 1, // 생성 요청은 422
        { method: "POST", match: "/git/refs", status: 422, json: { message: "Reference already exists" } },
        { method: "GET", match: "/git/ref/heads/reports", json: { ref: "refs/heads/reports" } });
      return r;
    })()
  },
  {
    name: "04-gpt-review-incomplete",
    description: "GPT 리뷰가 출력 한도로 잘림(status=incomplete) → 즉시 실패, 저장·게시 없음",
    env: baseEnv(),
    routes: replaceRoute(baseRoutes(), 2, {
      method: "POST", match: "api.openai.com", times: 1,
      json: { status: "incomplete", output_text: "PARTIAL", usage: { input_tokens: 100, output_tokens: 5000 } }
    })
  },
  {
    name: "05-claude-max-tokens",
    description: "Claude 답변이 max_tokens로 멈춤 → 실패, GPT 1회 비용만 쓰고 저장·게시 없음",
    env: baseEnv(),
    routes: replaceRoute(baseRoutes(), 3, {
      method: "POST", match: "api.anthropic.com",
      json: { content: [{ type: "text", text: "PARTIAL" }], stop_reason: "max_tokens", usage: {} }
    })
  },
  {
    name: "06-learning-incomplete",
    description: "교재 생성이 잘림 → 실패. GPT 리뷰·Claude 답변까지 비용을 썼지만 아무것도 저장되지 않음",
    env: baseEnv(),
    routes: replaceRoute(baseRoutes(), 4, {
      method: "POST", match: "api.openai.com", times: 1,
      json: { status: "incomplete", output_text: "PARTIAL", usage: {} }
    })
  },
  {
    name: "07-no-files",
    description: "변경 파일 0개 → AI 호출 전 실패",
    env: baseEnv(),
    routes: baseRoutes({ files: [] })
  },
  {
    name: "08-diff-truncated",
    description: "diff가 3만 자 초과 → 잘라서 'DIFF TRUNCATED' 표시 후 진행",
    env: baseEnv(),
    routes: baseRoutes({ files: [fileEntry(0, longPatch)] })
  },
  {
    name: "09-hundred-files-no-paging",
    description: "파일 100개 응답 → 101번째 이후 페이지를 요청하지 않음(누락 가능성 기록용)",
    env: baseEnv(),
    routes: baseRoutes({ files: many })
  },
  {
    name: "10-missing-key",
    description: "OPENAI_API_KEY 없음 → 어떤 요청도 보내기 전에 실패",
    env: baseEnv({ OPENAI_API_KEY: "" }),
    routes: baseRoutes()
  },
  {
    name: "11-invalid-pr-number",
    description: "PR 번호에 숫자 외 문자 → 요청 전에 실패",
    env: baseEnv({ PR_NUMBER: "7;rm" }),
    routes: baseRoutes()
  },
  {
    name: "12-issue-comment-fails",
    description: "Issue 댓글 실패(500) → 실패 종료. 단, reports 파일 2개는 이미 저장된 상태로 남음",
    env: baseEnv(),
    routes: replaceRoute(baseRoutes(), 8, {
      method: "POST", match: "/issues/1/comments", status: 500, json: { message: "Server Error" }
    })
  },
  {
    name: "13-openai-http-error",
    description: "OpenAI 429(요청 과다) → 재시도 없이 즉시 실패",
    env: baseEnv(),
    routes: replaceRoute(baseRoutes(), 2, {
      method: "POST", match: "api.openai.com", status: 429, json: { error: { message: "Rate limit" } }
    })
  },
  {
    name: "14-patch-missing",
    description: "큰 파일·바이너리라 patch 없음 → '[Patch unavailable]' 문구로 대체 후 진행",
    env: baseEnv(),
    routes: baseRoutes({ files: [{ ...fileEntry(), patch: undefined }] })
  }
];
