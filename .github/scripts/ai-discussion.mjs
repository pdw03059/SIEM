// MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md)
// MAZKION AI Review & Daily Technical Learning
// Node.js 20+
/*
 * ai-discussion.mjs — 진입 파일: 입력 확인 후 단계를 순서대로 실행
 *
 * 흐름: 입력 확인 → PR 읽기 → GPT 리뷰 → Claude 답변 → GPT 학습 교재 → 보고서 저장·게시
 * 구조(2단계 모듈 분리):
 *   ai/config.mjs     설정값·상수
 *   ai/transport.mjs  외부 통신의 유일한 출입구
 *   ai/github.mjs     GitHub API 기능
 *   ai/llm.mjs        OpenAI·Claude 호출
 *   ai/prompts.mjs    프롬프트 3종
 *   ai/report.mjs     보고서 조립·저장·게시
 * 원본(모듈 분리 전) 파일은 test/legacy/ai-discussion.v0.mjs에 글자 그대로 보존되어 있고,
 * 회귀 시험이 원본과 이 파일의 결과를 시나리오 14개로 비교한다.
 * 워크플로(.github/workflows/ai-discussion.yml)는 이 파일 경로를 그대로 실행한다.
 */
import {
  OPENAI_API_KEY,
  ANTHROPIC_API_KEY,
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  PR_NUMBER,
  ISSUE_NUMBER,
  GPT_REVIEW_MAX_TOKENS,
  GPT_LEARNING_MAX_TOKENS
} from "./ai/config.mjs";
import { getPullRequest } from "./ai/github.mjs";
import { callOpenAI, callClaude } from "./ai/llm.mjs";
import { reviewPrompt, claudeAnswerPrompt, learningPrompt } from "./ai/prompts.mjs";
import { publishReports } from "./ai/report.mjs";

/* ---- 1. 입력 확인: 키·저장소·PR 번호가 있고 번호가 숫자인지(요청 전에 멈추기 위해) ---- */
function validateEnvironment() {
  const required = {
    OPENAI_API_KEY,
    ANTHROPIC_API_KEY,
    GITHUB_TOKEN,
    GITHUB_REPOSITORY,
    PR_NUMBER
  };

  for (const [name, value] of Object.entries(required)) {
    if (!value) {
      throw new Error(`${name} is missing.`);
    }
  }

  if (!/^\d+$/.test(PR_NUMBER)) {
    throw new Error("Invalid PR number.");
  }

  if (!/^\d+$/.test(ISSUE_NUMBER)) {
    throw new Error("Invalid Issue number.");
  }
}

/* ---- 2. AI 단계 3개: 진행 로그 → 프롬프트 생성 → 호출 ---- */
async function reviewWithOpenAI(pr) {
  console.log("Starting GPT independent code review...");
  return await callOpenAI(reviewPrompt(pr), GPT_REVIEW_MAX_TOKENS);
}

async function discussWithClaude(pr, gptReview) {
  console.log("Sending GPT review to Claude...");
  return await callClaude(claudeAnswerPrompt(pr, gptReview));
}

async function generateDailyLearning(pr, gpt, claude) {
  console.log("Generating daily technical learning document...");
  return await callOpenAI(learningPrompt(pr, gpt, claude), GPT_LEARNING_MAX_TOKENS);
}

/* ---- 3. 전체 실행 ---- */
async function main() {
  validateEnvironment();

  // PR 코드 가져오기
  const pr = await getPullRequest();

  // GPT 독립 리뷰
  const gpt = await reviewWithOpenAI(pr);

  // Claude 반론 및 답변
  const claude = await discussWithClaude(pr, gpt.text);

  // GPT 일일 학습 교재 생성
  const learning = await generateDailyLearning(
    pr,
    gpt,
    claude
  );

  // 보고서 두 종류 저장 및 Issue 기록
  await publishReports(pr, gpt, claude, learning);

  console.log("MAZKION daily review and learning completed.");
}

main().catch(error => {
  console.error("MAZKION REVIEW FAILED:", error.message);
  process.exit(1);
});
