// MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md)
/*
 * report.mjs — 리뷰 보고서·학습 교재·Issue 댓글을 만들어 게시
 *
 * 무엇: 한국 시간 계산, 보고서 2종(.md) 본문 조립, reports 브랜치 저장, Issue 요약 댓글 게시.
 * 왜 따로: 보고서 양식은 6단계(합의 판정 보고서, 공개 요약/비공개 전체 분리)에서
 *     크게 바뀔 부분이라 통신·프롬프트와 떼어 두었다.
 * 주의(2단계): 문구·순서는 원본과 같다. 모델 이름과 요약 길이만 config.mjs의 상수를 쓰도록
 *     바꿨으며 값은 같다. 댓글 실패 시 파일 2개가 이미 저장된 채 끝나는 원본 동작
 *     (1단계 문제 #4)은 고치지 않았다.
 */
import {
  PR_NUMBER,
  ISSUE_NUMBER,
  GITHUB_RUN_ID,
  OPENAI_MODEL,
  CLAUDE_MODEL,
  ISSUE_COMMENT_MAX,
  SUMMARY_GPT_CHARS,
  SUMMARY_CLAUDE_CHARS,
  SUMMARY_LEARNING_CHARS
} from "./config.mjs";
import {
  ensureReportsBranch,
  saveReportArchive,
  postIssueComment
} from "./github.mjs";

/* ---- 1. 한국 시간: 날짜(YYYY-MM-DD)와 파일 이름용 시각(YYYYMMDD-HHMMSS) ---- */
export function getKoreaTimestamp() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const value = Object.fromEntries(
    parts.map(part => [part.type, part.value])
  );

  const date =
    `${value.year}-${value.month}-${value.day}`;

  const timestamp =
    `${value.year}${value.month}${value.day}-` +
    `${value.hour}${value.minute}${value.second}`;

  return { date, timestamp };
}

/* ---- 2. 보고서 2종 저장 + Issue 요약 댓글 ---- */
export async function publishReports(pr, gpt, claude, learning) {
  console.log("Preparing daily documents...");

  const { date, timestamp } = getKoreaTimestamp();

  const prefix =
    `PR-${String(PR_NUMBER).padStart(3, "0")}`;

  const uniqueId =
    `-${timestamp}-run${GITHUB_RUN_ID}`;

  const reviewPath =
    `reports/${date}/${prefix}-review${uniqueId}.md`;

  const learningPath =
    `reports/${date}/${prefix}-learning${uniqueId}.md`;

  // 코드 리뷰 보고서
  const reviewBody = [
    "# MAZKION AI 코드 리뷰 보고서",
    "",
    `- 작성 날짜: ${date} (KST)`,
    `- PR: [${pr.title}](${pr.url})`,
    `- 변경 파일: ${pr.files}개`,
    `- 브랜치: ${pr.branch}`,
    `- GPT 모델: ${OPENAI_MODEL}`,
    `- Claude 모델: ${CLAUDE_MODEL}`,
    "",
    "---",
    "",
    "# 1. GPT 독립 코드 리뷰",
    "",
    gpt.text,
    "",
    "---",
    "",
    "# 2. Claude의 리뷰 답변",
    "",
    claude.text,
    "",
    "---",
    "",
    "# 3. API 사용량",
    "",
    "| 모델 | 입력 토큰 | 출력 토큰 |",
    "|---|---:|---:|",
    `| GPT 리뷰 | ${gpt.usage.input_tokens ?? "N/A"} | ${gpt.usage.output_tokens ?? "N/A"} |`,
    `| Claude | ${claude.usage.input_tokens ?? "N/A"} | ${claude.usage.output_tokens ?? "N/A"} |`,
    "",
    "> 이 보고서는 AI의 정적 코드 검토 결과다. 실제 빌드, 테스트 및 실행 검증을 대신하지 않는다.",
    "",
    "최종 수정 및 병합 여부는 프로젝트 발주자가 결정한다."
  ].join("\n");

  // 일일 기술 학습 교재
  const learningBody = [
    "# MAZKION 일일 기술 학습 교재",
    "",
    `- 학습 날짜: ${date} (한국 시간)`,
    `- PR: [${pr.title}](${pr.url})`,
    `- 변경 파일: ${pr.files}개`,
    `- 학습 생성 모델: ${OPENAI_MODEL}`,
    "",
    "---",
    "",
    learning.text,
    "",
    "---",
    "",
    "## 학습 자료의 검증 범위",
    "",
    "이 교재는 해당 PR에서 제공된 코드 변경 사항과 AI 리뷰를 바탕으로 작성됐다.",
    "변경된 코드만으로 확인할 수 없는 시스템 전체 구조는 별도 확인이 필요하다.",
    "",
    "실제 구현 코드 및 테스트 결과와 대조하여 학습할 것.",
    "",
    "## 학습 생성 사용량",
    "",
    `- 입력 토큰: ${learning.usage.input_tokens ?? "N/A"}`,
    `- 출력 토큰: ${learning.usage.output_tokens ?? "N/A"}`
  ].join("\n");

  // reports 브랜치 확보
  await ensureReportsBranch(pr.baseSha);

  // 두 파일 모두 저장
  const reviewUrl = await saveReportArchive(
    reviewBody,
    reviewPath
  );

  const learningUrl = await saveReportArchive(
    learningBody,
    learningPath
  );

  // GitHub Issue 종합 기록
  const commentBody = [
    "# MAZKION AI 일일 개발 및 학습 기록",
    "",
    `- 날짜: ${date} (한국 시간)`,
    `- PR: [${pr.title}](${pr.url})`,
    "",
    "## 1. 코드 리뷰 보고서",
    "",
    `[코드 리뷰 보고서 열기](${reviewUrl})`,
    "",
    `파일 경로: \`${reviewPath}\``,
    "",
    "## 2. 일일 기술 학습 교재",
    "",
    `[오늘의 기술 학습 교재 열기](${learningUrl})`,
    "",
    `파일 경로: \`${learningPath}\``,
    "",
    "---",
    "",
    "## 3. 리뷰 요약",
    "",
    gpt.text.slice(0, SUMMARY_GPT_CHARS),
    "",
    "---",
    "",
    "## 4. Claude 답변 요약",
    "",
    claude.text.slice(0, SUMMARY_CLAUDE_CHARS),
    "",
    "---",
    "",
    "## 5. 학습 내용 요약",
    "",
    learning.text.slice(0, SUMMARY_LEARNING_CHARS),
    "",
    "---",
    "",
    "두 문서의 전체 내용은 reports 브랜치에 별도로 보관되어 있다.",
    "",
    "최종 수정 및 병합 여부는 사용자가 결정한다."
  ].join("\n");

  await postIssueComment(
    ISSUE_NUMBER,
    commentBody.slice(0, ISSUE_COMMENT_MAX)
  );

  console.log("All daily documents successfully published.");

  console.log(`Review: ${reviewUrl}`);
  console.log(`Learning: ${learningUrl}`);
}
