/* MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md) */
/*
 * registry_demo.c — 등록 표(registration table) 패턴이 실제로 동작함을 보이는 최소 예제
 *
 * 보여 주는 것
 *   1) X-매크로: mz_errors.def 한 곳에서 오류 열거형과 오류 정보 표를 함께 만든다
 *   2) 구조체 상수 배열: 쿼리 명령어 이름 → 처리 함수 표를 두고 이름으로 찾아 호출한다
 *
 * 빌드·시험: make test   (docs/CODING_RULES.md 4장·5장 참고)
 */

#include <stdio.h>    /* printf, fprintf — 결과를 화면에 출력합니다 */
#include <string.h>   /* strcmp — 명령어 이름 두 문자열이 같은지 비교합니다 */
#include <stddef.h>   /* size_t — 배열 크기·개수를 담는 부호 없는 정수 타입 */

/* ---------- 1) 오류 코드: X-매크로로 열거형 만들기 ---------- */

/* MZ_ERR 한 줄을 "열거형 이름," 으로 바꾸도록 매크로를 잠시 정의합니다(나머지 열은 버립니다) */
#define MZ_ERR(id, code, sev, summary, impact, causes, action) id,
typedef enum {                 /* typedef enum: 이름 붙은 정수 상수 묶음을 새 타입 이름으로 씁니다 */
#include "mz_errors.def"       /* 목록 파일을 그대로 끼워 넣어 MZ_OK, MZ_ERR_... 를 차례로 만듭니다 */
    MZ_ERR__COUNT              /* 마지막 항목 = 오류 코드 개수. 표 크기 확인에 씁니다 */
} mz_err_t;                    /* 모든 함수가 돌려줄 공통 오류 타입 */
#undef MZ_ERR                  /* 같은 이름을 다음 용도로 다시 정의하기 위해 지웁니다 */

/* 오류 하나의 사람용 정보(PLAN 10-3 형식) — 모든 칸이 읽기 전용 문자열입니다 */
typedef struct {
    const char *code;          /* "MZK-<모듈>-<번호>" 형식의 고유 코드 */
    const char *severity;      /* 정보·경고·오류 같은 심각도 */
    const char *summary;       /* 무엇이 / 왜 / 어디서 — 한 문장 요약 */
    const char *impact;        /* 그래서 무엇이 멈추거나 늦어지는지 */
    const char *causes;        /* 가능성 높은 순서의 원인 후보 */
    const char *action;        /* 바로 할 조치 */
} mz_err_info_t;               /* 오류 정보 구조체 타입 이름 */

/* 같은 목록을 이번에는 "{코드, 심각도, ...}," 구조체 초기값으로 바꾸도록 다시 정의합니다 */
#define MZ_ERR(id, code, sev, summary, impact, causes, action) \
    [id] = { code, sev, summary, impact, causes, action },   /* [id] = : 지정 초기화(C99~). 열거형 값 자리에 정확히 넣습니다 */
static const mz_err_info_t MZ_ERR_TABLE[] = {   /* static const: 이 파일 안에서만 보이는 읽기 전용 표(전역 "상태" 아님) */
#include "mz_errors.def"                         /* 목록을 다시 끼워 넣어 표의 각 칸을 채웁니다 */
};                                               /* 표 끝 */
#undef MZ_ERR                                    /* 매크로 정리 — 다른 파일에 새어 나가지 않게 합니다 */

/* 컴파일할 때 표 크기와 열거형 개수가 같은지 검사합니다. 다르면 빌드가 실패합니다(C11 _Static_assert) */
_Static_assert(sizeof MZ_ERR_TABLE / sizeof MZ_ERR_TABLE[0] == MZ_ERR__COUNT, "오류 표와 열거형 개수 불일치");

/* 오류 코드로 정보를 찾습니다. 범위를 벗어나면 NULL을 돌려줍니다(배열 밖 접근 방지) */
static const mz_err_info_t *mz_err_info(mz_err_t e)
{
    if ((unsigned)e >= (unsigned)MZ_ERR__COUNT) return NULL;   /* 음수·큰 값 모두 unsigned 비교 한 번으로 거릅니다 */
    return &MZ_ERR_TABLE[e];                                   /* 표에서 해당 칸의 주소를 돌려줍니다(복사 없음) */
}

/* 오류 정보를 PLAN 10-3 형식으로 출력합니다 */
static void mz_err_print(mz_err_t e)
{
    const mz_err_info_t *i = mz_err_info(e);                    /* 정보 찾기 */
    if (i == NULL) { printf("[알 수 없는 오류 %d]\n", (int)e); return; }   /* 표에 없는 값도 안전하게 처리합니다 */
    printf("[%s] %s | %s\n", i->code, i->severity, i->summary); /* 첫 줄: 코드 | 심각도 | 요약 */
    printf("  영향: %s\n  원인 후보: %s\n  조치: %s\n", i->impact, i->causes, i->action);   /* 나머지 칸 */
}

/* ---------- 2) 쿼리 명령어: 구조체 상수 배열 등록 표 ---------- */

/* 모든 명령어 처리 함수가 따라야 할 모양(함수 포인터 타입). 결과는 out 에 쓰고 오류는 반환값으로 */
typedef mz_err_t (*mz_cmd_fn)(const char *arg, int *out);

/* 실제 프로젝트에서는 아래 두 함수가 각각 src/query/cmd_head.c, cmd_count.c 같은 별도 파일에 있습니다 */
static mz_err_t cmd_head(const char *arg, int *out)
{
    (void)arg;          /* 이 예제에서는 인자를 쓰지 않습니다(쓰지 않는 매개변수 경고 방지) */
    *out = 10;          /* head 기본값 10건을 결과로 돌려준다고 가정합니다 */
    return MZ_OK;       /* 성공 */
}

static mz_err_t cmd_count(const char *arg, int *out)
{
    *out = (int)strlen(arg);   /* 예제용: 인자 문자열 길이를 "건수"로 돌려줍니다 */
    return MZ_OK;              /* 성공 */
}

/* 등록 표 한 칸: 이름, 처리 함수, 도움말(매뉴얼 자동 생성에 쓰임) */
typedef struct {
    const char *name;   /* 쿼리에서 쓰는 명령어 이름 */
    mz_cmd_fn   fn;     /* 처리 함수 주소 */
    const char *help;   /* 한 줄 설명 */
} mz_cmd_entry_t;       /* 명령어 등록 항목 타입 */

/* 새 명령어 추가 = 처리 함수 파일 1개 + 아래 표에 한 줄. 다른 코드는 고치지 않습니다 */
static const mz_cmd_entry_t MZ_CMD_TABLE[] = {
    { "head",  cmd_head,  "앞에서부터 N건만 남깁니다" },    /* 1번 명령어 */
    { "count", cmd_count, "건수를 셉니다" },                /* 2번 명령어 */
};                                                          /* 표 끝 */
/* 표의 항목 개수 = 전체 크기 / 한 칸 크기. 손으로 세지 않으므로 줄을 더해도 고칠 곳이 없습니다 */
#define MZ_CMD_COUNT (sizeof MZ_CMD_TABLE / sizeof MZ_CMD_TABLE[0])

/* 이름으로 명령어를 찾아 실행합니다. 없으면 오류 코드를 돌려줍니다 */
static mz_err_t mz_cmd_dispatch(const char *name, const char *arg, int *out)
{
    for (size_t k = 0; k < MZ_CMD_COUNT; k++) {               /* 표를 처음부터 끝까지 훑습니다 */
        if (strcmp(MZ_CMD_TABLE[k].name, name) == 0)           /* 이름이 같으면 */
            return MZ_CMD_TABLE[k].fn(arg, out);               /* 그 칸의 함수 포인터로 호출합니다 */
    }
    return MZ_ERR_QRY_UNKNOWN_CMD;                             /* 끝까지 못 찾으면 등록되지 않은 명령어 */
}

/* 시험 하나를 실행하고 기대한 오류 코드와 같은지 확인합니다. 실패 개수(0 또는 1)를 돌려줍니다 */
static int check(const char *name, const char *arg, mz_err_t want)
{
    int out = -1;                                              /* 결과 칸을 표시용 값으로 초기화합니다 */
    mz_err_t got = mz_cmd_dispatch(name, arg, &out);           /* 등록 표를 통해 실행 */
    printf("명령 %-6s → %s, 결과=%d\n", name, mz_err_info(got)->code, out);   /* 결과 출력 */
    if (got != want) { fprintf(stderr, "실패: %s\n", name); return 1; }      /* 기대와 다르면 실패 1건 */
    return 0;                                                  /* 통과 */
}

int main(void)
{
    printf("== 오류 코드 표 (%d개) ==\n", (int)MZ_ERR__COUNT);  /* 표 제목과 개수 */
    for (int e = 0; e < (int)MZ_ERR__COUNT; e++)              /* 모든 오류 코드를 차례로 */
        mz_err_print((mz_err_t)e);                            /* PLAN 10-3 형식으로 출력합니다 */

    printf("== 명령어 등록 표 (%zu개) ==\n", MZ_CMD_COUNT);   /* %zu: size_t 값을 출력하는 형식 */
    for (size_t k = 0; k < MZ_CMD_COUNT; k++)                  /* 등록된 명령어마다 */
        printf("  %-6s %s\n", MZ_CMD_TABLE[k].name, MZ_CMD_TABLE[k].help);   /* 이름과 도움말 — 매뉴얼 자동 생성의 원리 */

    int fails = 0;                                             /* 실패한 시험 개수 */
    fails += check("head", "", MZ_OK);                         /* 등록된 명령어는 성공해야 합니다 */
    fails += check("count", "abc", MZ_OK);                     /* 두 번째 명령어도 성공해야 합니다 */
    fails += check("sort", "", MZ_ERR_QRY_UNKNOWN_CMD);        /* 없는 명령어는 정해진 오류 코드여야 합니다 */
    if (fails == 0) printf("시험 통과: 3/3\n");                /* 모두 통과 */
    return fails == 0 ? 0 : 1;                                 /* 종료 코드 0 = 성공, make가 이를 보고 판정합니다 */
}
