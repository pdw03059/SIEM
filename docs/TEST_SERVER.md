<!-- MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md) -->
# TEST_SERVER — 실험 서버(MAZKION Lab) 준비 가이드

목적: 야간 개발 세션이 코드를 올리면 실험 서버가 **자동으로** 빌드·기능 시험·장애 재현·성능 측정·AI 모델 평가를 하고 결과를 PR에 남긴다. 팀장(Claude)은 결과를 읽고 고친다.
연결 방식: 실험 서버가 GitHub에 먼저 접속해 일감을 가져가는 **GitHub 자체 호스팅 실행기**(서버에 들어오는 포트를 열 필요 없음).

## 1. 하드웨어
| 용도 | 최소 | 권장 |
|---|---|---|
| CPU | 8코어 | 16코어 이상 |
| 메모리 | 32GB | 64GB |
| 디스크 | NVMe SSD 1TB | NVMe 2TB(시스템 + `/data` 분리) |
| GPU(AI 학습·평가) | 없음(CPU로 소형 모델 추론만) | NVIDIA VRAM 24GB 이상 1장(RTX 3090/4090급) — 소형 모델 미세조정(QLoRA)용 |
| 네트워크 | 유선, 외부 HTTPS(443) 나가는 연결 | 같음 |
고객 데이터는 절대 두지 않는다. 시험 로그는 합성 데이터만 쓴다.

## 2. OS
Ubuntu Server 24.04 LTS 권장(GPU 드라이버·AI 도구 지원이 가장 쉬움). Rocky Linux 9도 가능(고객 환경 호환 시험용으로 나중에 VM 추가).

## 3. 설치 (주인님이 한 번만, 복사·붙여넣기)
```bash
# 3-1. 기본 패키지와 실험 전용 계정(관리자 권한 없이 실행)
sudo apt update && sudo apt -y upgrade
sudo apt -y install build-essential clang gcc make cmake git curl jq python3-pip python3-venv \
     valgrind gdb linux-tools-common sysstat chrony nodejs npm docker.io
sudo useradd -m -s /bin/bash mzlab && sudo usermod -aG docker mzlab
sudo mkdir -p /data && sudo chown mzlab:mzlab /data
sudo timedatectl set-ntp true            # 시계 동기화(시간 품질 시험의 기준)

# 3-2. (GPU가 있을 때만) NVIDIA 드라이버 — 설치 후 재부팅
sudo ubuntu-drivers install && sudo reboot
# 재부팅 후 확인
nvidia-smi
```

## 4. GitHub 실행기 연결
1. 웹에서 https://github.com/pdw03059/SIEM → **Settings → Actions → Runners → New self-hosted runner → Linux x64** 를 엽니다.
2. 화면에 나오는 명령(다운로드·`./config.sh --url … --token …`)을 **mzlab 계정으로** 그대로 실행합니다(`sudo -iu mzlab`).
   - 이름: `mazkion-lab`
   - 라벨 추가: `mazkion-lab` (GPU가 있으면 `gpu`도)
3. 서비스로 등록(재부팅해도 자동 시작):
```bash
cd ~/actions-runner && sudo ./svc.sh install mzlab && sudo ./svc.sh start
```
토큰은 1시간짜리 일회용이라 팀장이 대신 발급할 수 없습니다. 이 단계만 주인님이 해 주시면 됩니다.

## 5. 보안 설정 (반드시)
공개 저장소라 외부인이 보낸 코드가 이 서버에서 실행되면 안 됩니다.
1. **Settings → Actions → General → Fork pull request workflows from outside collaborators** → `Require approval for all external contributors` 선택.
2. 실험 서버용 워크플로는 `push`(main, night/* 브랜치)와 `schedule`, 수동 실행에서만 동작하도록 팀장이 작성합니다. `pull_request` 이벤트로는 절대 실험 서버를 쓰지 않습니다.
3. 실행기는 관리자 권한 없는 `mzlab` 계정으로만 실행합니다.
4. 서버 방화벽: 들어오는 연결은 SSH(관리용)만, 나머지 차단.
```bash
sudo ufw default deny incoming && sudo ufw allow OpenSSH && sudo ufw enable
```

## 6. 실험 서버가 매일 하는 일 (팀장이 워크플로로 작성)
| 실험 | 내용 |
|---|---|
| 빌드·정적 검사 | 경고 0, 보안 컴파일 옵션, 정적 분석 |
| 기능 시험 | 수집 → 전달 → 저장 → 검색 → 탐지 → 소명 끝에서 끝까지 |
| 퍼징 | 파서·통신·쿼리 해석기에 이상 입력 대량 투입(AddressSanitizer 빌드) |
| 장애 재현 | FIELD_NOTES L01~L15: 노드 강제 종료, 디스크 가득 참, 시계 미래로, 세션 비정상 끊김, 스케줄러 정지, 업그레이드 후 옵션 누락 등 |
| 설치 시험 | 컨테이너로 가상 노드 수십~100대를 띄워 설치·조인·업그레이드·제거 자동 시험(PLAN 13장) |
| 성능 | 초당 처리량, 검색 시간, 메모리, 지연 — 매일 기록해 느려지면 경고 |
| AI 평가 | 파서·마스킹·쿼리·시나리오 골든셋 정확도(PLAN 12장), GPU 있으면 미세조정 실험 |
결과는 PR 댓글과 `docs/LAB_RESULTS.md`에 남습니다.

## 7. 실시간 확인(선택)
Claude 데스크톱 앱은 Windows·macOS용입니다. 실험 서버를 Linux로 쓰면 실시간 작업은 위 실행기로 하고, 주인님 Windows/Mac PC에 데스크톱 앱을 연결하면 팀장이 그 PC에서 SSH로 실험 서버에 들어가 직접 디버깅할 수도 있습니다.
