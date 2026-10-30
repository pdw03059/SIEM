/*
 * minilog_query.c — 1단계 조회기: 기간과 키워드로 저장된 로그를 찾아 출력합니다.
 *
 * 파이프 쿼리로 쓰면  table from=20261029 to=20261029 syslog | search line == "*error*"
 * 와 비슷한 일을 하는 가장 단순한 버전입니다(인덱스 없이 파일 전체를 순서대로 읽는 "풀스캔").
 *
 * 사용 예: ./minilog-query -d ./data -f 2026-10-29 -t 2026-10-29 -s error
 */

#define _POSIX_C_SOURCE 200809L   /* localtime_r, strptime 류의 POSIX 함수 사용 선언 */
#define _DEFAULT_SOURCE           /* memmem(바이트 배열 안에서 부분 문자열 찾기) 같은 확장 함수 사용 선언 */

#include <stdio.h>        /* fopen, fread, printf */
#include <stdlib.h>       /* malloc, free */
#include <string.h>       /* strcmp, memmem, memset */
#include <time.h>         /* mktime, localtime_r, strftime */
#include <arpa/inet.h>    /* inet_ntop — IP를 문자열로 */
#include <netinet/in.h>   /* struct in_addr */

#include "common.h"       /* record_header 구조체 */

/* "YYYY-MM-DD" 문자열을 그날 자정의 time_t(초)로 바꿉니다. 실패하면 -1 */
static time_t parse_date(const char *s)
{
    struct tm tmv;                                 /* 달력 구조체 */
    memset(&tmv, 0, sizeof(tmv));                  /* 시·분·초를 0(자정)으로 두기 위해 전부 0으로 초기화 */
    if (sscanf(s, "%d-%d-%d", &tmv.tm_year, &tmv.tm_mon, &tmv.tm_mday) != 3)   /* 숫자 3개를 읽어 냅니다. 3개가 아니면 형식 오류 */
        return (time_t)-1;
    tmv.tm_year -= 1900;                           /* struct tm의 연도는 1900년부터 센 값이라 1900을 뺍니다 (C의 오래된 규칙) */
    tmv.tm_mon  -= 1;                              /* 월은 0~11로 저장합니다 (1월 = 0) */
    tmv.tm_isdst = -1;                             /* 서머타임 여부는 시스템이 판단하도록 맡깁니다 */
    return mktime(&tmv);                           /* 현지 시각 달력 → 유닉스 초로 변환 */
}

/* 파티션 파일 하나를 처음부터 끝까지 읽으며 키워드가 들어간 로그를 출력합니다. 찾은 건수를 반환 */
static long scan_file(const char *path, const char *keyword)
{
    FILE *fp = fopen(path, "rb");                  /* "rb" = 바이너리 읽기 */
    if (!fp) return 0;                             /* 그날 파일이 없으면(로그가 없던 날) 0건 */

    size_t kwlen = keyword ? strlen(keyword) : 0;  /* 키워드 길이. 키워드가 없으면(NULL) 0 → 전체 출력 */
    char *msg = malloc(MINILOG_MAX_MSG + 1);       /* 메시지를 담을 버퍼를 힙에 할당. +1은 끝에 '\0'(문자열 끝 표시)을 넣을 자리 */
    if (!msg) { fclose(fp); return 0; }            /* 메모리 할당 실패 시 정리 후 종료 */

    long hits = 0;                                 /* 찾은 건수 */
    struct record_header h;                        /* 읽어 들일 헤더 */

    while (fread(&h, sizeof(h), 1, fp) == 1) {     /* 헤더 16바이트를 읽습니다. 파일 끝이면 1이 아니므로 반복 종료 */
        if (h.len > MINILOG_MAX_MSG) {             /* 길이가 말이 안 되게 크면 파일이 손상된 것 */
            fprintf(stderr, "%s: 손상된 레코드 발견, 읽기 중단\n", path);
            break;                                 /* 더 읽으면 엉뚱한 위치를 해석하므로 중단합니다 */
        }
        if (fread(msg, 1, h.len, fp) != h.len)     /* 헤더가 알려 준 길이만큼 원문을 읽습니다 */
            break;                                 /* 덜 읽혔다면 파일이 중간에 끊긴 것(수집기 비정상 종료 등) */
        msg[h.len] = '\0';                         /* C 문자열은 '\0'으로 끝나야 printf로 출력할 수 있습니다 */

        /* 키워드가 없거나, 메시지 안에 키워드가 있으면 출력 */
        if (kwlen == 0 || memmem(msg, h.len, keyword, kwlen) != NULL) {
            char ts[32], ip[INET_ADDRSTRLEN];      /* 시각 문자열, IP 문자열을 담을 배열 */
            time_t sec = (time_t)(h.time_ms / 1000);
            struct tm tmv;
            localtime_r(&sec, &tmv);
            strftime(ts, sizeof(ts), "%Y-%m-%d %H:%M:%S", &tmv);   /* 사람이 읽는 시각 형식 */
            struct in_addr a = { .s_addr = h.src_ip };              /* 저장해 둔 IP를 주소 구조체에 넣고 */
            inet_ntop(AF_INET, &a, ip, sizeof(ip));                 /* "192.168.0.10" 형식 문자열로 변환 */
            printf("%s.%03u  %-15s  %s\n", ts,                      /* 시각.밀리초  IP  원문 */
                   (unsigned)(h.time_ms % 1000), ip, msg);
            hits++;
        }
    }

    free(msg);                                     /* malloc으로 받은 메모리는 반드시 free로 돌려줘야 합니다(안 하면 메모리 누수) */
    fclose(fp);
    return hits;
}

int main(int argc, char *argv[])
{
    const char *datadir = MINILOG_DEFAULT_DIR;     /* 데이터 폴더 */
    const char *from = NULL, *to = NULL;           /* 조회 시작일, 종료일 */
    const char *keyword = NULL;                    /* 검색어(없으면 전체) */

    for (int i = 1; i < argc; i++) {               /* 인자 해석 */
        if      (!strcmp(argv[i], "-d") && i + 1 < argc) datadir = argv[++i];
        else if (!strcmp(argv[i], "-f") && i + 1 < argc) from    = argv[++i];
        else if (!strcmp(argv[i], "-t") && i + 1 < argc) to      = argv[++i];
        else if (!strcmp(argv[i], "-s") && i + 1 < argc) keyword = argv[++i];
        else {
            fprintf(stderr, "사용법: %s -f YYYY-MM-DD -t YYYY-MM-DD [-s 키워드] [-d 데이터폴더]\n", argv[0]);
            return 1;
        }
    }
    if (!from) { fprintf(stderr, "-f 시작일이 필요합니다\n"); return 1; }
    if (!to) to = from;                            /* 종료일을 안 주면 시작일 하루만 조회 */

    time_t t_from = parse_date(from), t_to = parse_date(to);
    if (t_from == (time_t)-1 || t_to == (time_t)-1 || t_from > t_to) {
        fprintf(stderr, "날짜 형식 또는 범위 오류\n");
        return 1;
    }

    long total = 0;
    /* 시작일부터 종료일까지 하루씩 넘어가며 그날의 파티션 파일만 엽니다 = "파티션 프루닝"
       조회 기간 밖의 파일은 아예 열지 않으므로, 기간을 좁게 줄수록 빨라집니다 */
    for (time_t day = t_from; day <= t_to; ) {
        struct tm tmv;
        localtime_r(&day, &tmv);                   /* 현재 날짜를 달력으로 */
        char date[16], path[MINILOG_PATH_MAX + 64];   /* 폴더 + 테이블명 + 파일명이 들어갈 여유 */
        strftime(date, sizeof(date), "%Y-%m-%d", &tmv);
        snprintf(path, sizeof(path), "%s/%s/%s.dat", datadir, MINILOG_TABLE, date);
        total += scan_file(path, keyword);         /* 그날 파일을 스캔해 건수를 더합니다 */

        tmv.tm_mday += 1;                          /* 다음 날로. 31일+1처럼 범위를 넘어도 mktime이 다음 달로 자동 정리해 줍니다 */
        tmv.tm_hour = 0; tmv.tm_min = 0; tmv.tm_sec = 0;
        tmv.tm_isdst = -1;
        day = mktime(&tmv);
    }

    fprintf(stderr, "총 %ld건\n", total);          /* 결과 건수는 stderr로 출력해 결과 본문(stdout)과 섞이지 않게 합니다 */
    return 0;
}
