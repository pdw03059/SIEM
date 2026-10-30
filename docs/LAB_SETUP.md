<!-- MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md) -->
# LAB_SETUP — 개인 데스크톱에 MAZKION 실험실 만들고 팀장(Claude)에게 연결하기

**연결 원리**: 팀장의 작업 공간에서는 외부 서버로 SSH 접속이 막혀 있습니다. 대신 데스크톱에 **GitHub 실행기**를 설치하면, 데스크톱이 GitHub에 먼저 접속해 "할 일"을 받아 갑니다. 팀장이 밤에 코드를 올리면 → 데스크톱이 자동으로 빌드·시험·측정 → 결과가 GitHub에 올라오고 → 팀장이 읽고 고칩니다. 공유기 포트 개방이나 고정 IP는 필요 없습니다.

두 가지 길 중 하나를 고르세요.
- **길 A: Windows 그대로 + WSL2(리눅스)** — 데스크톱을 평소에도 쓰실 때. 대부분 이쪽을 권장합니다.
- **길 B: Ubuntu 직접 설치** — 데스크톱을 실험 전용으로 바꿀 때(성능 측정이 가장 정확).

준비물: GitHub 계정(pdw03059) 로그인, 인터넷, 1~2시간. **고객 데이터·회사 자료는 실험실에 절대 두지 않습니다.**

---

## 0단계. 공통 사전 확인 (5분)
1. 작업 관리자(Ctrl+Shift+Esc) → 성능 탭 캡처를 팀장에게 보내 주세요(CPU·메모리·디스크·GPU 확인용).
2. 같은 화면의 CPU 항목에서 **"가상화: 사용"**인지 확인합니다. "사용 안 함"이면 BIOS에서 Intel VT-x 또는 AMD SVM을 켭니다(길 A에 필요).
3. 디스크 여유 공간 100GB 이상 확보.

---

## 길 A. Windows + WSL2

### A-1. WSL2와 Ubuntu 설치 (15분)
1. 시작 메뉴에서 **PowerShell**을 마우스 오른쪽 → **관리자 권한으로 실행**.
2. 다음을 붙여 넣고 실행 후 **재부팅**:
```powershell
wsl --install -d Ubuntu-24.04
```
3. 재부팅 후 Ubuntu 창이 자동으로 열리면 리눅스 사용자 이름(예: `seungmo`)과 비밀번호를 정합니다.

### A-2. WSL2가 쓸 자원 정하기 (5분)
메모장으로 `C:\Users\<윈도우사용자>\.wslconfig` 파일을 만들고 아래를 넣습니다(메모리는 전체의 절반 정도, 예: 16GB PC면 8GB).
```ini
[wsl2]
memory=8GB
processors=4
swap=8GB
```
PowerShell에서 `wsl --shutdown` 후 다시 Ubuntu를 엽니다.

### A-3. 백그라운드 서비스 켜기 (2분)
Ubuntu 창에서:
```bash
sudo tee /etc/wsl.conf >/dev/null <<'EOF'
[boot]
systemd=true
EOF
```
PowerShell에서 `wsl --shutdown` → Ubuntu 다시 열기 → `systemctl is-system-running` 이 `running` 또는 `degraded`면 정상.

### A-4. (NVIDIA 그래픽카드가 있을 때만) GPU
- **Windows에** 최신 NVIDIA 드라이버만 설치합니다(Ubuntu 안에는 드라이버를 설치하지 않습니다).
- Ubuntu에서 `nvidia-smi` 가 그래픽카드를 보여 주면 성공.

→ 이제 **공통 1단계**로 갑니다.

### A-5. 밤새 꺼지지 않게 (공통 1~3단계를 마친 뒤)
1. Windows **설정 → 시스템 → 전원** → 절전 모드 "안 함"(최소 밤 시간대).
2. WSL이 혼자 꺼지지 않도록 Windows 시작 시 자동 실행 등록 — PowerShell(관리자)에서:
```powershell
$a = New-ScheduledTaskAction -Execute "wsl.exe" -Argument "-d Ubuntu-24.04 --exec sleep infinity"
$t = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "MAZKION-Lab-WSL" -Action $a -Trigger $t -RunLevel Highest
```
3. Windows 업데이트 "활성 시간"을 밤 시간 재부팅이 안 되게 조정.

---

## 길 B. Ubuntu 직접 설치

### B-1. 설치 USB 만들기 (20분)
1. 데스크톱의 중요한 파일을 **먼저 백업**합니다(디스크가 지워집니다).
2. https://ubuntu.com/download/server 에서 **Ubuntu Server 24.04 LTS** ISO를 받습니다.
3. 8GB 이상 USB에 balenaEtcher 또는 Rufus로 ISO를 굽습니다.

### B-2. 설치 (30분)
1. USB로 부팅 → 언어 English 권장 → 디스크 전체 사용.
2. 사용자 이름·비밀번호 설정, **"Install OpenSSH server" 체크**.
3. 설치 후 재부팅, 로그인.

### B-3. 절전 끄기
```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

### B-4. (NVIDIA 그래픽카드가 있을 때만)
```bash
sudo ubuntu-drivers install && sudo reboot
nvidia-smi
```
→ **공통 1단계**로.

---

## 공통 1단계. 기본 도구와 실험 계정 (10분)
Ubuntu(길 A는 Ubuntu 창, 길 B는 로그인 화면)에서 통째로 붙여 넣습니다.
```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install build-essential clang gcc make cmake git curl jq unzip \
     python3-pip python3-venv valgrind gdb sysstat chrony docker.io
sudo useradd -m -s /bin/bash mzlab
sudo usermod -aG docker mzlab
sudo mkdir -p /data && sudo chown mzlab:mzlab /data
sudo timedatectl set-ntp true
echo "OK: 기본 도구 설치 완료"
```

## 공통 2단계. GitHub 보안 설정 (5분, 웹 브라우저)
공개 저장소이므로 **외부인이 보낸 코드가 내 데스크톱에서 실행되지 않게** 먼저 막습니다.
1. https://github.com/pdw03059/SIEM/settings/actions 접속.
2. **Fork pull request workflows from outside collaborators** → **Require approval for all external contributors** 선택 → Save.
3. 같은 페이지 **Workflow permissions** → **Read repository contents and packages permissions** 선택 → Save.

## 공통 3단계. 실행기 설치·연결 (10분)
1. 브라우저: https://github.com/pdw03059/SIEM/settings/actions/runners/new 접속 → **Linux**, **x64** 선택.
2. 화면의 **Download** 부분 명령과 **Configure** 부분 명령이 나옵니다(토큰 포함, 1시간 안에 사용).
3. Ubuntu에서 실험 계정으로 바꾼 뒤, 화면의 명령을 순서대로 붙여 넣습니다:
```bash
sudo -iu mzlab
mkdir -p ~/actions-runner && cd ~/actions-runner
# ↓ 여기에 GitHub 화면의 Download 명령들(curl …, tar …)을 붙여 넣기
# ↓ 이어서 Configure 명령(./config.sh --url https://github.com/pdw03059/SIEM --token …)을 붙여 넣기
```
4. `config.sh`가 물어보면:
   - runner group: 그냥 Enter
   - **runner name: `mazkion-lab`**
   - **additional labels: `mazkion-lab`** (GPU가 있으면 `mazkion-lab,gpu`)
   - work folder: 그냥 Enter
5. 서비스로 등록(재부팅해도 자동 시작):
```bash
exit                                   # mzlab에서 나와 원래 사용자로
cd /home/mzlab/actions-runner
sudo ./svc.sh install mzlab
sudo ./svc.sh start
sudo ./svc.sh status                   # active (running) 이면 성공
```
6. 브라우저에서 https://github.com/pdw03059/SIEM/settings/actions/runners 를 새로고침 → `mazkion-lab`이 **Idle(초록)** 이면 연결 완료.

## 공통 4단계. 방화벽 (길 B만, 2분)
```bash
sudo ufw default deny incoming && sudo ufw allow OpenSSH && sudo ufw enable
```

## 공통 5단계. 팀장에게 알리기
"실험실 연결했다"고만 말씀해 주세요. 팀장이:
1. 연결 확인용 작업(빌드 + 시스템 정보 수집)을 한 번 보내 결과를 확인하고,
2. 그날 밤부터 자동 실험(기능 시험·장애 재현·성능 기록·AI 평가)을 시작하며,
3. 결과는 PR 댓글과 `docs/LAB_RESULTS.md`에 남깁니다.

---

## (선택) 실시간 연결: Claude 데스크톱 앱
길 A(Windows)라면 Windows에 **Claude 데스크톱 앱**을 설치하고, 이 MAZKION 대화를 앱에서 열어 이 컴퓨터와 연결하면, 주인님이 지켜보실 때 팀장이 그 PC에서 직접 명령을 실행하며 문제를 파고들 수 있습니다. 밤샘 자동 실험은 위 실행기로 충분하므로 필수는 아닙니다.

## 문제가 생기면
| 증상 | 확인 |
|---|---|
| Runners 화면에 Offline | `sudo /home/mzlab/actions-runner/svc.sh status`, 길 A는 WSL이 켜져 있는지(`wsl -l -v`에서 Running) |
| 토큰 만료 오류 | Runners → New self-hosted runner 화면을 새로 열어 새 토큰으로 3단계 반복 |
| `nvidia-smi` 안 됨(길 A) | Windows NVIDIA 드라이버 재설치, `wsl --update` |
| 디스크 부족 | `/data` 정리, 팀장에게 알리면 실험 데이터 보관 기간을 줄임 |

## 하지 말 것
- 고객 로그·회사 자료·회사 VPN 연결을 이 실험실에 두지 않습니다.
- 실행기를 관리자(root) 계정으로 실행하지 않습니다(`mzlab` 계정 사용).
- 저장소 Settings의 2단계 보안 설정을 끄지 않습니다.
