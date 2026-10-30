# Makefile — 소스 코드를 실행 파일로 만드는(빌드) 규칙을 적어 두는 파일입니다.
# 터미널에서 make 라고만 치면 아래 규칙대로 컴파일이 진행됩니다.

# 사용할 C 컴파일러
CC      = gcc
# -O2: 최적화, -g: 디버깅 정보, -Wall -Wextra: 경고 최대로, -std=c11: C11 표준
CFLAGS  = -O2 -g -Wall -Wextra -std=c11
# 소스 폴더
SRC     = src

all: minilogd minilog-query                    # make 만 치면 두 프로그램을 모두 만듭니다

# minilogd는 아래 두 파일이 바뀌면 다시 빌드합니다. 레시피의 $@ = 만들 대상 이름(minilogd)
minilogd: $(SRC)/minilogd.c $(SRC)/common.h
	$(CC) $(CFLAGS) -o $@ $(SRC)/minilogd.c

minilog-query: $(SRC)/minilog_query.c $(SRC)/common.h
	$(CC) $(CFLAGS) -o $@ $(SRC)/minilog_query.c

clean:                                         # make clean: 빌드 결과물과 테스트 데이터 삭제
	rm -f minilogd minilog-query
	rm -rf data

.PHONY: all clean                              # all, clean은 실제 파일 이름이 아니라 명령 이름이라는 표시
