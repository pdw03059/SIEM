// MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md)
/*
 * llm.mjs — OpenAI·Claude API 호출
 *
 * 무엇: 프롬프트를 보내고 { text, usage }를 돌려주는 함수 두 개.
 * 왜 따로: 원본에서는 Claude 호출 코드가 discussWithClaude 안에 직접 들어 있었다.
 *     호출을 함수로 빼 두면 5단계 반복 토론에서 Claude를 여러 번 부를 때 그대로 쓸 수 있다.
 * 주의(2단계): 요청 본문, 응답 검사 순서, 오류 문구를 원본과 똑같이 유지했다.
 *     - 출력이 잘리면(OpenAI status≠completed, Claude stop_reason≠end_turn) 바로 예외를 던지는
 *       원본 동작(1단계 문제 #1·#2)과 재시도 없음(#3)은 고치지 않았다.
 *     - Claude 오류 문구 "Claude discussion was incomplete."는 답변 단계 전용 문구지만,
 *       시험 정답과 맞추기 위해 그대로 두었다. 다른 용도로 부를 때는 5단계에서 문구를 정리한다.
 */
import {
  OPENAI_API_KEY,
  ANTHROPIC_API_KEY,
  OPENAI_URL,
  OPENAI_MODEL,
  ANTHROPIC_URL,
  ANTHROPIC_VERSION,
  CLAUDE_MODEL,
  CLAUDE_MAX_TOKENS,
  CLAUDE_EFFORT
} from "./config.mjs";
import { send } from "./transport.mjs";

/* ---- 1. OpenAI Responses API ---- */
export async function callOpenAI(prompt, maxTokens) {
  const response = await send(
    OPENAI_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: prompt,
        max_output_tokens: maxTokens
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `OpenAI API error ${response.status}: ${
        data.error?.message || "Unknown error"
      }`
    );
  }

  // output_text가 없으면 output 배열 안의 글 조각을 이어 붙인다
  const text = (
    data.output_text ||
    (data.output || [])
      .flatMap(item => item.content || [])
      .filter(item => item.type === "output_text")
      .map(item => item.text)
      .join("")
  ).trim();

  if (!text || data.status !== "completed") {
    throw new Error("OpenAI response was incomplete.");
  }

  return {
    text,
    usage: data.usage || {}
  };
}

/* ---- 2. Claude Messages API ---- */
export async function callClaude(prompt) {
  const response = await send(
    ANTHROPIC_URL,
    {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: CLAUDE_MAX_TOKENS,
        output_config: {
          effort: CLAUDE_EFFORT
        },
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Claude API error ${response.status}: ${
        data.error?.message || "Unknown error"
      }`
    );
  }

  // 응답의 text 조각만 이어 붙인다
  const answer = (data.content || [])
    .filter(item => item.type === "text")
    .map(item => item.text)
    .join("")
    .trim();

  if (!answer || data.stop_reason !== "end_turn") {
    throw new Error("Claude discussion was incomplete.");
  }

  return {
    text: answer,
    usage: data.usage || {}
  };
}
