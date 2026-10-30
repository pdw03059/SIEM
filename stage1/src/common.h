/* MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md) */
/*
 * common.h — 수집기(minilogd)와 조회기(minilog-query)가 함께 쓰는 정의 모음
 *
 * 헤더 파일(.h)은 "선언"을 모아 두는 파일입니다.
 * 여러 .c 파일이 같은 구조체·상수를 써야 할 때, 한 곳에 적어 두고
 * 각 .c 파일에서 #include "common.h" 로 불러와 씁니다.
 */

#ifndef MINILOG_COMMON_H      /* 이 헤더가 아직 포함되지 않았다면 아래를 처리합니다 (중복 포함 방지 시작) */
#define MINILOG_COMMON_H      /* "포함됨" 표시를 남깁니다. 같은 파일을 두 번 include 해도 한 번만 처리됩니다 */

#include <stdint.h>           /* uint32_t, uint64_t 처럼 크기가 정확히 정해진 정수 타입을 쓰기 위해 포함합니다 */

#define MINILOG_DEFAULT_PORT  5140       /* 기본 수신 포트. 514는 root 권한이 필요해서 일반 계정도 쓸 수 있는 5140을 씁니다 */
#define MINILOG_DEFAULT_DIR   "./data"   /* 기본 데이터 저장 폴더 */
#define MINILOG_TABLE         "syslog"   /* 1단계에서는 테이블을 하나만 씁니다. 2단계에서 장비별 테이블로 나눕니다 */
#define MINILOG_MAX_MSG       65535      /* UDP 패킷 하나의 최대 크기(바이트). 이보다 큰 syslog 메시지는 올 수 없습니다 */
#define MINILOG_PATH_MAX      512        /* 파일 경로 문자열의 최대 길이 */

/*
 * 디스크에 저장되는 "레코드 헤더" 구조
 *
 * 로그 한 건은 [헤더 16바이트][원문 메시지 len 바이트] 순서로 파일 끝에 이어 붙여 저장합니다(append).
 * 상용 로그 저장소들이 흔히 쓰는 "뒤에 계속 붙여 쓰는(append-only)" 방식이며,
 * 읽을 때는 헤더를 먼저 읽어 len을 알아낸 뒤, 그만큼 메시지를 읽습니다.
 *
 * __attribute__((packed)) : 컴파일러가 구조체 멤버 사이에 빈 바이트(패딩)를 넣지 못하게 합니다.
 * 디스크 포맷은 항상 같은 크기·배치여야 하므로 패딩을 없애 정확히 16바이트로 고정합니다.
 */
struct __attribute__((packed)) record_header {
    uint64_t time_ms;   /* 수신 시각. 1970-01-01 00:00:00 UTC 이후 경과한 밀리초(유닉스 시간) — 8바이트 */
    uint32_t src_ip;    /* 보낸 장비의 IPv4 주소(네트워크 바이트 순서 그대로 저장) — 4바이트 */
    uint32_t len;       /* 뒤따라오는 원문 메시지의 길이(바이트) — 4바이트 */
};                      /* 합계 8 + 4 + 4 = 16바이트 */

#endif                  /* MINILOG_COMMON_H — 중복 포함 방지 끝 */
