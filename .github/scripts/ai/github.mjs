// MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md)
/*
 * github.mjs — GitHub REST API 기능
 *
 * 무엇: PR과 변경 파일 읽기, reports 브랜치 확보, 보고서 파일 저장, Issue 댓글 게시.
 * 왜 따로: GitHub 쪽 기능을 한 파일에 모아, 나중에 Copilot 리뷰 수집(3단계)이나
 *     비공개 저장소 저장(6단계)을 이 파일에 함수로 추가하면 되게 했다.
 * 주의(2단계): 원본 함수(githubRequest, getPullRequest, ensureReportsBranch,
 *     saveReportArchive)를 동작 그대로 옮겼다. Issue 댓글 게시는 원본 publishReports 안에
 *     있던 요청을 postIssueComment로 이름만 붙여 뺐다.
 *     1단계에서 발견한 한계(파일 목록 한 페이지만 요청 등)도 고치지 않고 그대로 두었다.
 */
import {
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  PR_NUMBER,
  GITHUB_API_BASE,
  API_VERSION,
  REPORTS_BRANCH,
  MAX_DIFF_LENGTH
} from "./config.mjs";
import { send } from "./transport.mjs";

/* ---- 1. 공통 요청: 인증 헤더를 붙이고, 404 허용 옵션과 오류 처리를 담당 ---- */
export async function githubRequest(path, options = {}) {
  const { allowNotFound = false, ...fetchOptions } = options;

  const response = await send(
    `${GITHUB_API_BASE}/repos/${GITHUB_REPOSITORY}${path}`,
    {
      ...fetchOptions,
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "Content-Type": "application/json",
        ...fetchOptions.headers
      }
    }
  );

  const body = await response.text();

  // 없어도 되는 대상(예: 아직 없는 브랜치)이면 null로 알려 준다
  if (response.status === 404 && allowNotFound) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `GitHub API error ${response.status}: ${body.slice(0, 1000)}`
    );
  }

  return body ? JSON.parse(body) : null;
}

/* ---- 2. PR 정보와 변경 파일(diff) 읽기 ---- */
export async function getPullRequest() {
  console.log(`Reading PR #${PR_NUMBER}...`);

  const pr = await githubRequest(`/pulls/${PR_NUMBER}`);

  // 한 페이지(최대 100개)만 요청한다(원본 그대로, 101번째부터 누락되는 한계 있음)
  const files = await githubRequest(
    `/pulls/${PR_NUMBER}/files?per_page=100`
  );

  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("No changed files found in this PR.");
  }

  // 파일마다 "이름·상태·증감·patch" 묶음을 만든다
  const codeFiles = files.map(file => {
    return [
      `### File: ${file.filename}`,
      `Status: ${file.status}`,
      `Changes: +${file.additions} / -${file.deletions}`,
      file.patch || "[Patch unavailable: binary or large file]",
      ""
    ].join("\n");
  });

  let diff = codeFiles.join("\n");

  // 너무 길면 앞부분만 보내고 잘렸다는 표시를 붙인다
  if (diff.length > MAX_DIFF_LENGTH) {
    diff =
      diff.slice(0, MAX_DIFF_LENGTH) +
      "\n\n[DIFF TRUNCATED: Review only the supplied portion.]";
  }

  return {
    title: pr.title,
    url: pr.html_url,
    branch: `${pr.head.ref} → ${pr.base.ref}`,
    description: pr.body || "(No description)",
    files: files.length,
    diff,
    baseSha: pr.base.sha
  };
}

/* ---- 3. reports 브랜치가 없으면 PR base 커밋에서 만든다 ---- */
export async function ensureReportsBranch(baseSha) {
  const branch = REPORTS_BRANCH;

  const existingRef = await githubRequest(
    `/git/ref/heads/${branch}`,
    { allowNotFound: true }
  );

  if (existingRef) {
    console.log("Reports branch already exists.");
    return;
  }

  console.log("Creating reports branch...");

  try {
    await githubRequest("/git/refs", {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: baseSha
      })
    });
  } catch (error) {
    // 동시에 다른 실행이 만들었을 수 있다: 다시 확인해서 있으면 성공으로 본다
    const refAfterError = await githubRequest(
      `/git/ref/heads/${branch}`,
      { allowNotFound: true }
    );

    if (!refAfterError) {
      throw error;
    }
  }
}

/* ---- 4. reports 브랜치에 Markdown 파일 하나 저장하고 보기 주소를 돌려준다 ---- */
export async function saveReportArchive(content, filePath) {
  const branch = REPORTS_BRANCH;

  const encodedPath = filePath
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  await githubRequest(`/contents/${encodedPath}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `Archive MAZKION report: ${filePath}`,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch
    })
  });

  console.log(`Archived: ${filePath}`);

  return `https://github.com/${GITHUB_REPOSITORY}/blob/${branch}/${filePath}`;
}

/* ---- 5. Issue에 댓글 하나 게시(본문 길이 자르기는 부르는 쪽이 한다) ---- */
export async function postIssueComment(issueNumber, body) {
  await githubRequest(
    `/issues/${issueNumber}/comments`,
    {
      method: "POST",
      body: JSON.stringify({
        body
      })
    }
  );
}
