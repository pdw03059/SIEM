<!-- MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md) -->
# ai/ — AI 코드 리뷰 자동화 모듈

**무엇**: `.github/scripts/ai-discussion.mjs`(진입 파일)가 쓰는 모듈입니다. PR을 읽고 GPT 리뷰 → Claude 답변 → GPT 학습 교재를 만든 뒤, reports 브랜치와 Issue에 게시합니다.

**왜 나눴나**: 원본은 808줄짜리 파일 하나였습니다. 다음 단계에서 Copilot 리뷰 수집, 코드 문맥 수집, 반복 토론, 보고서 분리를 붙이려면, 각 기능이 들어갈 자리가 따로 있어야 다른 부분을 건드리지 않고 고칠 수 있습니다. 2단계에서는 **동작을 하나도 바꾸지 않고 자리만 나눴습니다.**

| 파일 | 책임 | 의존 |
|---|---|---|
| `config.mjs` | 환경 변수, 모델 이름, 출력 한도, API 주소·버전 | 없음 |
| `transport.mjs` | **외부 통신의 유일한 출입구** | 없음 |
| `github.mjs` | PR 읽기, reports 브랜치, 파일 저장, Issue 댓글 | config, transport |
| `llm.mjs` | OpenAI·Claude 호출 | config, transport |
| `prompts.mjs` | 프롬프트 3종 (원본 문장 그대로) | 없음 |
| `report.mjs` | 한국 시간, 보고서 조립·저장·댓글 | config, github |

## 지켜야 할 규칙
- `fetch`는 `transport.mjs`에서만 씁니다. 네트워크·프로세스 모듈(`net`, `http`, `https`, `tls`, `dns`, `child_process` 등), `require`, 동적 `import()`, `globalThis`는 운영 파일 어디에서도 쓰지 않습니다. 회귀 시험 `transport-boundary`가 검사합니다.
- 상수는 `config.mjs` 한 곳에만 둡니다.
- 프롬프트 문구를 바꾸면 회귀 시험의 정답과 달라집니다. 문구 변경은 발주자 승인 후, 정답 갱신과 같은 커밋에서 합니다.

## 확장하는 법 (다음 단계 예정 위치)
- Copilot 리뷰 수집: `github.mjs`에 함수 추가
- 재시도·호출 횟수·토큰 예산·DRY_RUN 차단: `transport.mjs`와 `llm.mjs`
- 반복 토론: 새 파일 `debate.mjs`
- 공개 요약·비공개 전체 기록 분리: `report.mjs`

## 시험
`node --test .github/scripts/test/*.test.mjs` — 시험 설명은 `../test/README.md`에 있습니다.
