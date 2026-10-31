// MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md)
/*
 * config.mjs — 설정값과 상수를 한 곳에 모은 파일
 *
 * 무엇: 환경 변수(키·저장소·PR 번호 등)와 모델 이름, 출력 한도, API 주소·버전.
 * 왜: 원본에서는 모델 이름이 세 곳(호출 2곳 + 보고서 문구)에 따로 적혀 있었다.
 *     한 곳에서 바꾸면 호출과 보고서가 함께 바뀌도록 모았다(CLAUDE.md: 상수는 한 곳에서 정의).
 * 주의(2단계): 값은 원본과 똑같다. 기본값(ISSUE_NUMBER="1", GITHUB_RUN_ID="local")도 그대로다.
 *     환경 변수는 원본처럼 모듈을 불러오는 순간 한 번 읽는다.
 */

/* ---- 1. 실행 환경 변수(워크플로가 넣어 줌) ---- */
export const {
  OPENAI_API_KEY,
  ANTHROPIC_API_KEY,
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  PR_NUMBER,
  ISSUE_NUMBER = "1",
  GITHUB_RUN_ID = "local"
} = process.env;

/* ---- 2. GitHub ---- */
export const GITHUB_API_BASE = "https://api.github.com";
export const API_VERSION = "2022-11-28"; // GitHub REST API 버전 헤더 값
export const REPORTS_BRANCH = "reports"; // 보고서를 보관하는 브랜치
export const MAX_DIFF_LENGTH = 30000; // AI에 보내는 diff 최대 글자 수(초과분은 잘라냄)
export const ISSUE_COMMENT_MAX = 65000; // Issue 댓글 최대 글자 수(GitHub 한도 65,536 아래)

/* ---- 3. OpenAI ---- */
export const OPENAI_URL = "https://api.openai.com/v1/responses";
export const OPENAI_MODEL = "gpt-6-luna";
export const GPT_REVIEW_MAX_TOKENS = 5000; // GPT 리뷰 출력 한도
export const GPT_LEARNING_MAX_TOKENS = 8000; // 학습 교재 출력 한도

/* ---- 4. Anthropic(Claude) ---- */
export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
export const CLAUDE_MODEL = "claude-sonnet-5";
export const CLAUDE_MAX_TOKENS = 5000; // Claude 답변 출력 한도
export const CLAUDE_EFFORT = "low";

/* ---- 5. 보고서 요약 길이(Issue 댓글에 넣는 각 부분의 최대 글자 수) ---- */
export const SUMMARY_GPT_CHARS = 12000;
export const SUMMARY_CLAUDE_CHARS = 8000;
export const SUMMARY_LEARNING_CHARS = 8000;
