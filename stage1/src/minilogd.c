/* MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md) */
/*
 * minilogd.c — 1단계 수집기: UDP Syslog를 받아 일자별 파티션 파일에 저장합니다.
 *
 * 동작 흐름
 *   1) UDP 소켓을 열고 포트에 묶는다(bind)
 *   2) 패킷이 올 때까지 기다렸다가 받는다(recvfrom)
 *   3) 받은 시각으로 오늘 날짜(YYYY-MM-DD)를 계산한다
 *   4) data/syslog/YYYY-MM-DD.dat 파일 끝에 [헤더 + 원문]을 붙여 쓴다
 *   5) 날짜가 바뀌면 이전 파일을 닫고 새 날짜 파일을 연다 (일자별 파티션)
 *   6) Ctrl-C(SIGINT)나 kill(SIGTERM)을 받으면 파일을 안전하게 닫고 종료한다
 *
 * 빌드: make            실행: ./minilogd -p 5140 -d ./data
 */

#define _POSIX_C_SOURCE 200809L  /* clock_gettime, localtime_r, sigaction 같은 POSIX 함수를 쓰겠다고 컴파일러에 알립니다 */

#include <stdio.h>        /* printf, fprintf, fopen, fwrite, fflush, fclose — 표준 입출력 */
#include <stdlib.h>       /* atoi(문자열→정수), exit — 표준 유틸리티 */
#include <string.h>       /* strcmp, strerror, memset, snprintf에 쓰는 문자열 함수 */
#include <errno.h>        /* errno — 시스템 함수가 실패했을 때 실패 이유 번호가 담기는 전역 변수 */
#include <signal.h>       /* sigaction — Ctrl-C 같은 신호를 받았을 때 실행할 함수를 등록 */
#include <time.h>         /* clock_gettime, localtime_r, strftime — 시간 계산 */
#include <unistd.h>       /* close — 파일 디스크립터(소켓 포함) 닫기 */
#include <sys/stat.h>     /* mkdir — 폴더 만들기 */
#include <sys/socket.h>   /* socket, bind, recvfrom, setsockopt — 소켓 함수 */
#include <netinet/in.h>   /* struct sockaddr_in, htons, INADDR_ANY — IPv4 주소 구조체 */
#include <arpa/inet.h>    /* inet_ntop — IP 주소를 "192.168.0.1" 같은 문자열로 바꾸기 */

#include "common.h"       /* 우리가 정의한 record_header 구조체와 상수들 */

/*
 * 종료 요청 깃발(flag)
 * volatile      : 이 변수는 신호 처리 함수가 "언제든" 바꿀 수 있으니, 컴파일러가 최적화로 값을 캐시하지 말고
 *                 매번 메모리에서 새로 읽으라는 뜻입니다.
 * sig_atomic_t  : 신호 처리 중에도 한 번에(원자적으로) 읽고 쓸 수 있도록 보장된 정수 타입입니다.
 * static        : 이 파일(minilogd.c) 안에서만 보이는 전역 변수로 만듭니다.
 */
static volatile sig_atomic_t g_stop = 0;

/* 신호(SIGINT, SIGTERM)를 받으면 운영체제가 이 함수를 호출합니다 */
static void on_signal(int signo)
{
    (void)signo;   /* 매개변수를 쓰지 않는다고 명시합니다. 쓰지 않는 변수 경고를 막는 C의 관용 표현입니다 */
    g_stop = 1;    /* 깃발만 세웁니다. 신호 처리 함수 안에서는 printf 같은 복잡한 함수를 부르면 위험하기 때문입니다 */
}

/* 현재 시각을 밀리초 단위 유닉스 시간으로 돌려줍니다 */
static uint64_t now_ms(void)
{
    struct timespec ts;                        /* 초(tv_sec)와 나노초(tv_nsec)를 담는 구조체 */
    clock_gettime(CLOCK_REALTIME, &ts);        /* 실제 달력 시각(벽시계 시간)을 ts에 채웁니다. &ts는 "ts의 주소"를 넘긴다는 뜻 */
    return (uint64_t)ts.tv_sec * 1000ULL       /* 초를 밀리초로 바꿉니다. 1000ULL은 64비트 부호 없는 정수 1000 — 곱셈 넘침 방지 */
         + (uint64_t)(ts.tv_nsec / 1000000);   /* 나노초를 밀리초로 바꿔 더합니다 (1밀리초 = 1,000,000나노초) */
}

/*
 * 밀리초 시간을 "YYYY-MM-DD" 날짜 문자열로 바꿉니다.
 * out    : 결과를 써 넣을 문자 배열의 주소(포인터)
 * outlen : 그 배열의 크기 — 배열 범위를 넘어 쓰지 않도록(버퍼 오버플로 방지) 함께 받습니다
 */
static void ms_to_date(uint64_t ms, char *out, size_t outlen)
{
    time_t sec = (time_t)(ms / 1000);          /* 밀리초를 초 단위로 바꿉니다. time_t는 시간을 초로 담는 표준 타입 */
    struct tm tmv;                             /* 연·월·일·시·분·초가 나뉘어 담기는 구조체 */
    localtime_r(&sec, &tmv);                   /* 초를 "현지 시각(KST)" 달력으로 변환해 tmv에 채웁니다. _r은 스레드에 안전한 버전 */
    strftime(out, outlen, "%Y-%m-%d", &tmv);   /* 형식 문자열대로 날짜 문자열을 만듭니다. %Y=연도 4자리, %m=월, %d=일 */
}

/* 폴더가 없으면 만듭니다. 이미 있으면(EEXIST) 성공으로 봅니다 */
static int ensure_dir(const char *path)
{
    if (mkdir(path, 0755) == 0) return 0;      /* 0755 = 주인은 읽기·쓰기·실행, 나머지는 읽기·실행 권한(8진수 표기) */
    if (errno == EEXIST) return 0;             /* "이미 존재함" 오류는 문제가 아니므로 성공 처리 */
    fprintf(stderr, "mkdir %s 실패: %s\n", path, strerror(errno));   /* 그 외 실패는 이유를 표준 에러로 출력 */
    return -1;                                 /* -1은 C에서 흔히 쓰는 "실패" 반환값 */
}

/* 사용법 안내를 출력합니다 */
static void usage(const char *prog)
{
    fprintf(stderr, "사용법: %s [-p 포트] [-d 데이터폴더]\n", prog);
}

int main(int argc, char *argv[])      /* argc = 실행 인자 개수, argv = 인자 문자열들의 배열 */
{
    int port = MINILOG_DEFAULT_PORT;              /* 수신 포트 기본값 */
    const char *datadir = MINILOG_DEFAULT_DIR;    /* 데이터 폴더 기본값. const = 이 포인터로 문자열 내용을 바꾸지 않겠다는 약속 */

    /* ---------- 1. 실행 인자 해석 ---------- */
    for (int i = 1; i < argc; i++) {                              /* argv[0]은 프로그램 이름이므로 1번부터 봅니다 */
        if (strcmp(argv[i], "-p") == 0 && i + 1 < argc) {         /* "-p" 뒤에 값이 하나 더 있으면 */
            port = atoi(argv[++i]);                               /* 다음 인자를 정수로 바꿔 포트로 씁니다. ++i로 그 값을 건너뜀 */
        } else if (strcmp(argv[i], "-d") == 0 && i + 1 < argc) {  /* "-d" 뒤의 값은 데이터 폴더 */
            datadir = argv[++i];
        } else {                                                  /* 모르는 인자가 오면 */
            usage(argv[0]);                                       /* 사용법을 보여 주고 */
            return 1;                                             /* 0이 아닌 값으로 종료 = 실패 */
        }
    }
    if (port <= 0 || port > 65535) {                              /* 포트 번호는 1~65535 범위여야 합니다 */
        fprintf(stderr, "포트 범위 오류: %d\n", port);
        return 1;
    }

    /* ---------- 2. 저장 폴더 준비: data/ 와 data/syslog/ ---------- */
    char tabledir[MINILOG_PATH_MAX];                              /* 테이블 폴더 경로를 담을 문자 배열(스택에 할당) */
    snprintf(tabledir, sizeof(tabledir), "%s/%s", datadir, MINILOG_TABLE);   /* "./data/syslog" 를 만듭니다. snprintf는 배열 크기를 넘지 않음 */
    if (ensure_dir(datadir) != 0 || ensure_dir(tabledir) != 0)    /* 둘 중 하나라도 실패하면 */
        return 1;                                                 /* 종료 */

    /* ---------- 3. 종료 신호 처리 등록 ---------- */
    struct sigaction sa;                          /* 신호 처리 방법을 담는 구조체 */
    memset(&sa, 0, sizeof(sa));                   /* 구조체 전체를 0으로 초기화. C는 지역 변수를 자동으로 0으로 만들어 주지 않습니다 */
    sa.sa_handler = on_signal;                    /* 신호가 오면 on_signal 함수를 호출하라 */
    sigaction(SIGINT, &sa, NULL);                 /* Ctrl-C */
    sigaction(SIGTERM, &sa, NULL);                /* kill 명령의 기본 신호 */
    /* sa_flags에 SA_RESTART를 넣지 않았으므로, 신호가 오면 대기 중인 recvfrom이 즉시 깨어나(EINTR) 루프를 빠져나올 수 있습니다 */

    /* ---------- 4. UDP 소켓 생성 ---------- */
    int sock = socket(AF_INET, SOCK_DGRAM, 0);    /* AF_INET = IPv4, SOCK_DGRAM = UDP. 성공하면 파일 디스크립터(정수 번호) 반환 */
    if (sock < 0) {                               /* 음수면 실패 */
        perror("socket");                         /* perror는 errno의 의미를 "socket: 이유" 형태로 출력합니다 */
        return 1;
    }

    int rcvbuf = 8 * 1024 * 1024;                 /* 커널 수신 버퍼를 8MB로 요청합니다 */
    setsockopt(sock, SOL_SOCKET, SO_RCVBUF, &rcvbuf, sizeof(rcvbuf));
    /* UDP는 받는 쪽이 늦으면 커널 버퍼가 넘쳐 패킷이 버려집니다(유실). 버퍼를 키우면 순간 폭주를 견딜 여유가 생깁니다.
       실제 최대값은 /proc/sys/net/core/rmem_max 설정에 따라 제한됩니다 */

    struct sockaddr_in addr;                      /* IPv4 주소+포트를 담는 구조체 */
    memset(&addr, 0, sizeof(addr));               /* 0으로 초기화 */
    addr.sin_family = AF_INET;                    /* IPv4 주소임을 표시 */
    addr.sin_addr.s_addr = htonl(INADDR_ANY);     /* 0.0.0.0 = 서버의 모든 네트워크 카드에서 받기. htonl은 바이트 순서를 네트워크 순서로 변환 */
    addr.sin_port = htons((uint16_t)port);        /* 포트 번호도 네트워크 바이트 순서(빅엔디언)로 변환해서 넣어야 합니다 */

    if (bind(sock, (struct sockaddr *)&addr, sizeof(addr)) < 0) {   /* 소켓을 해당 주소·포트에 묶습니다. 이미 쓰는 포트면 실패 */
        perror("bind");
        close(sock);                              /* 실패해도 열어 둔 소켓은 닫고 나갑니다(자원 정리) */
        return 1;
    }
    printf("minilogd: UDP %d 포트 수신 시작, 저장 위치 %s\n", port, tabledir);
    fflush(stdout);                               /* 출력 버퍼를 즉시 비워 화면에 바로 보이게 합니다 */

    /* ---------- 5. 수신·저장 루프 ---------- */
    static char buf[MINILOG_MAX_MSG];             /* 수신 버퍼 64KB. static으로 두면 스택이 아닌 데이터 영역에 잡혀 스택 넘침 위험이 없습니다 */
    char cur_date[16] = "";                       /* 현재 열려 있는 파일의 날짜. 빈 문자열 = 아직 연 파일 없음 */
    FILE *fp = NULL;                              /* 현재 날짜 파티션 파일. NULL = 열린 파일 없음 */
    uint64_t count = 0;                           /* 저장한 로그 건수(통계용) */

    while (!g_stop) {                             /* 종료 깃발이 서기 전까지 반복 */
        struct sockaddr_in src;                   /* 보낸 쪽 주소가 채워질 구조체 */
        socklen_t srclen = sizeof(src);           /* 주소 구조체 크기. recvfrom이 실제 크기로 고쳐 줍니다 */

        ssize_t n = recvfrom(sock, buf, sizeof(buf), 0,          /* 패킷 하나를 buf에 받습니다. 올 때까지 여기서 멈춰 기다림(블로킹) */
                             (struct sockaddr *)&src, &srclen);  /* 보낸 쪽 IP·포트를 src에 채웁니다 */
        if (n < 0) {                              /* 받기 실패 */
            if (errno == EINTR) continue;         /* 신호 때문에 깨어난 경우: 루프 맨 위로 가서 g_stop을 확인합니다 */
            perror("recvfrom");                   /* 그 외 오류는 출력하고 계속 받습니다 */
            continue;
        }

        uint64_t t = now_ms();                    /* 수신 시각. 장비가 보낸 시각이 아니라 "받은 시각"을 기준으로 저장합니다
                                                     → 장비 시계가 틀려도(예: 2028년) 미래 날짜 파티션이 생기지 않습니다 */
        char date[16];
        ms_to_date(t, date, sizeof(date));        /* 수신 시각의 날짜 문자열 "YYYY-MM-DD" */

        /* 날짜가 바뀌었거나 아직 파일을 안 열었으면 파티션 파일을 (다시) 엽니다 */
        if (fp == NULL || strcmp(date, cur_date) != 0) {
            if (fp) fclose(fp);                   /* 이전 날짜 파일이 열려 있으면 닫습니다(버퍼에 남은 데이터도 디스크로 기록됨) */
            char path[MINILOG_PATH_MAX + 32];      /* 폴더 경로(최대 512) + "/YYYY-MM-DD.dat"(15) 가 들어갈 여유를 둡니다 */
            snprintf(path, sizeof(path), "%s/%s.dat", tabledir, date);   /* "./data/syslog/2026-10-29.dat" */
            fp = fopen(path, "ab");               /* "a" = 파일 끝에 이어 쓰기(append), "b" = 바이너리 모드. 파일이 없으면 새로 만듭니다 */
            if (!fp) {                            /* 열기 실패(디스크 가득, 권한 등) */
                perror("fopen");
                continue;                         /* 이번 로그는 저장하지 못하고 다음 패킷으로 넘어갑니다 */
            }
            snprintf(cur_date, sizeof(cur_date), "%s", date);   /* 현재 날짜를 기억합니다 */
            printf("파티션 열기: %s\n", path);
            fflush(stdout);
        }

        struct record_header h;                   /* 디스크에 쓸 16바이트 헤더 */
        h.time_ms = t;                            /* 수신 시각 */
        h.src_ip  = src.sin_addr.s_addr;          /* 보낸 장비 IP (네트워크 바이트 순서 그대로) */
        h.len     = (uint32_t)n;                  /* 메시지 길이 */

        /* 헤더 → 원문 순서로 파일 끝에 붙여 씁니다. fwrite는 실제로 쓴 "개수"를 돌려주므로 1이 아니면 실패입니다 */
        if (fwrite(&h, sizeof(h), 1, fp) != 1 || fwrite(buf, (size_t)n, 1, fp) != 1) {
            perror("fwrite");
            continue;
        }

        count++;                                  /* 저장 건수 증가 */
        if (count % 1000 == 0) fflush(fp);        /* 1000건마다 C 라이브러리 버퍼를 운영체제로 내보냅니다.
                                                     매 건 fflush하면 안전하지만 느리고, 너무 드물면 장애 시 잃는 양이 늘어납니다(성능↔안전 절충) */
    }

    /* ---------- 6. 종료 정리 ---------- */
    if (fp) fclose(fp);                           /* 남은 버퍼를 디스크로 쓰고 파일을 닫습니다 */
    close(sock);                                  /* 소켓을 닫아 포트를 반납합니다 */
    printf("minilogd 종료: 총 %llu건 저장\n", (unsigned long long)count);   /* %llu = unsigned long long 출력 형식 */
    return 0;                                     /* 0 = 정상 종료 */
}
