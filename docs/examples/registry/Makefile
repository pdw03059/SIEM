# MAZKION(마즈키온) — 왕의 사관 '마즈키르' + '자카르(기억하다)' + '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md)
# Makefile — 등록 표 예제를 빌드하고 시험합니다. 사용법: make -C docs/examples/registry test

# C 컴파일러. 시스템 기본 cc 를 씁니다
CC      = cc
# C11 표준, 경고 최대(-Wall -Wextra), 경고를 오류로 취급(-Werror) — 경고 0건을 강제합니다
CFLAGS  = -std=c11 -Wall -Wextra -Werror -O2 -g
# 시험용 추가 옵션: 메모리 오류(ASan)·정의되지 않은 동작(UBSan) 검사기. make test-san 에서만 씁니다
SANFLAGS = -fsanitize=address,undefined -fno-omit-frame-pointer

all: registry_demo                              # make 만 치면 예제 실행 파일을 만듭니다

# 예제 실행 파일은 소스와 오류 목록(.def)이 바뀌면 다시 빌드합니다
registry_demo: registry_demo.c mz_errors.def
	$(CC) $(CFLAGS) -o $@ registry_demo.c

test: registry_demo                             # 빌드 후 실행해 종료 코드 0이면 통과입니다
	./registry_demo

test-san: registry_demo.c mz_errors.def         # 검사기를 켠 별도 실행 파일로 같은 시험을 돌립니다
	$(CC) $(CFLAGS) $(SANFLAGS) -o registry_demo_san registry_demo.c
	./registry_demo_san

clean:                                          # 빌드 결과물을 지웁니다
	rm -f registry_demo registry_demo_san

.PHONY: all test test-san clean                 # 파일이 아니라 명령 이름이라는 표시
