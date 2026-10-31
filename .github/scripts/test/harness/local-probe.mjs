// MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md)
/*
 * local-probe.mjs — 격리 공간 안에서 "권한 상태"와 "지정된 서비스 소켓의 접근 가능 여부"를 조사해 JSON으로 출력
 *
 * 목적(발주자 결정 2026-10-31): 시험 프로그램이 네트워크 격리 공간 안에서도 로컬 서비스 소켓을 통해
 *   "실수로" 외부 통신을 하게 되는 경로가 있는지 확인한다. 악성 코드 방어용 샌드박스 검사가 아니다.
 *
 * 범위 제한(발주자 지시):
 *   - 폴더 탐색·재귀 탐색을 하지 않는다. 아래 SERVICE_SOCKETS 표에 적힌 표준 경로만 본다.
 *   - 소켓 검사(서비스 소켓·추상 소켓)는 GitHub Actions 실행기에서만 한다. 그 밖의 곳에서는 권한 상태만 출력한다.
 *     GITHUB_ACTIONS·RUNNER_ENVIRONMENT 값은 "어디서 실행할지"를 제한하는 용도일 뿐이다. 환경 변수는 누구나
 *     설정할 수 있으므로 실행 환경을 믿을 근거나 보안 검증의 증거로 쓰지 않는다.
 *   - 데이터 전송·명령 실행·서비스 설정 변경을 하지 않는다.
 *
 * 검사 방법(서비스 소켓에는 접속하지 않는다 — 부작용 0):
 *   1) stat: 경로가 있는지, 소켓 파일인지 → 없으면 "미존재"
 *   2) access(W_OK): 이 사용자가 접속할 권한이 있는지(유닉스 소켓은 쓰기 권한이 있어야 접속 가능)
 *      → 운영체제가 경로의 모든 상위 폴더 통과 권한과 ACL까지 반영해 판단한다.
 *      → 실제 접속을 하지 않으므로 상대 서비스에는 아무 요청도 가지 않는다.
 *      결과는 "파일 시스템 권한 기준 잠재적 접근 가능성"이다(실제 접속 성공 여부가 아님).
 *      AppArmor 같은 추가 정책은 반영되지 않을 수 있으나, 그 경우 결과가 더 나쁘게(가능) 나오는 쪽이다.
 *   위험 판정은 "권한 있음"만으로 한다. 서비스가 꺼져 있어도 접속하면 소켓 활성화(socket activation)로
 *   켜질 수 있으므로, 실제로 듣고 있는지는 위험 판정에 필요 없다.
 *   (처음 설계는 "서비스가 실행 중이면 접속해 보기"였으나, 실행 중 확인에 쓰는 systemctl 자체가
 *    systemd 소켓에 접속하므로 발주자 조건(지정 경로만, 명령 실행 금지)에 맞지 않아 뺐다.)
 *
 * 출력: { status, idmap, sockets: { 이름: { path, purpose, kind, exists, isSocket, writable, note } }, abstract }
 * 사용: node local-probe.mjs [--abstract=<이름>]
 */
import fs from "node:fs";
import net from "node:net";

const CONNECT_TIMEOUT_MS = 2000;

/* ---- 검사 대상 표: 경로·목적·서비스 이름·소켓 종류를 한 곳에 적는다 ---- */
export const SERVICE_SOCKETS = [
  { name: "docker", path: "/run/docker.sock", kind: "stream",
    purpose: "Docker 엔진 API. 접속되면 컨테이너를 띄워 호스트 네트워크로 통신하거나 관리자 권한을 얻을 수 있음" },
  { name: "dbus-system", path: "/run/dbus/system_bus_socket", kind: "stream",
    purpose: "D-Bus 시스템 버스. 접속되면 다른 시스템 서비스에 작업을 요청할 수 있음" },
  { name: "resolved-varlink", path: "/run/systemd/resolve/io.systemd.Resolve", kind: "stream",
    purpose: "systemd-resolved 이름 조회 창구. 접속되면 격리 밖에서 DNS 조회를 대신 해 줄 수 있음(DNS로 정보 유출 경로)" },
  { name: "journald-native", path: "/run/systemd/journal/socket", kind: "dgram",
    purpose: "journald 로그 쓰기 창구. 원격 로그 전달이 설정돼 있으면 로그 내용이 밖으로 나가는 경로가 됨" },
  { name: "journald-stdout", path: "/run/systemd/journal/stdout", kind: "stream",
    purpose: "journald 표준 출력 로그 창구. 위와 같은 이유" },
  { name: "journald-devlog", path: "/dev/log", kind: "dgram",
    purpose: "syslog 호환 로그 창구(/run/systemd/journal/dev-log로 연결). 위와 같은 이유" }
];

/* ---- GitHub 제공 실행기에서만 실행 ---- */
export function onGithubHostedRunner(env = process.env) {
  return env.GITHUB_ACTIONS === "true" && env.RUNNER_ENVIRONMENT === "github-hosted";
}

/* ---- 1. 권한 상태(/proc/self/status) ---- */
function status() {
  const want = /^(Uid|Gid|Groups|CapInh|CapPrm|CapEff|CapBnd|CapAmb|NoNewPrivs):\s*(.*)$/;
  const out = {};
  for (const line of fs.readFileSync("/proc/self/status", "utf8").split("\n")) {
    const m = line.match(want);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
function readOrNull(p) {
  try { return fs.readFileSync(p, "utf8").trim(); } catch { return null; }
}

/* ---- 2. 추상 소켓 전용: 시험이 직접 연 자기 소켓에 접속만 해 보고 즉시 닫기(데이터 전송 없음) ---- */
function connectOnly(target) {
  return new Promise(resolve => {
    const s = net.connect({ path: target });
    const done = r => { clearTimeout(timer); s.destroy(); resolve(r); };
    const timer = setTimeout(() => done({ result: "error", code: "TIMEOUT" }), CONNECT_TIMEOUT_MS);
    s.on("connect", () => done({ result: "connected" }));
    s.on("error", e => done({ result: e.code === "ECONNREFUSED" ? "refused" : e.code === "EACCES" ? "denied" : "error", code: e.code }));
  });
}

/* ---- 3. 지정 경로 하나 검사(접속하지 않음) ---- */
function checkSocket(spec) {
  const out = { path: spec.path, purpose: spec.purpose, kind: spec.kind };
  let st;
  try {
    st = fs.statSync(spec.path); // /dev/log처럼 링크인 경로는 따라가서 실제 소켓을 본다
  } catch (e) {
    if (e.code === "ENOENT") return { ...out, exists: false, note: "미존재" };
    return { ...out, exists: null, error: e.code, note: "검사 오류 → 판정 불가" };
  }
  out.exists = true;
  out.isSocket = st.isSocket();
  if (!out.isSocket) return { ...out, note: "소켓 아님" };
  try { fs.accessSync(spec.path, fs.constants.W_OK); out.writable = true; } catch (e) {
    if (e.code === "EACCES" || e.code === "EPERM") out.writable = false;
    else return { ...out, writable: null, error: e.code, note: "검사 오류 → 판정 불가" };
  }
  return { ...out, note: out.writable ? "잠재적 접근 가능(파일 시스템 권한 기준)" : "권한 없음" };
}

/* ---- 4. 실행 ---- */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const abstractArg = process.argv.find(a => a.startsWith("--abstract="));
  const out = {
    status: status(),
    idmap: { uid_map: readOrNull("/proc/self/uid_map"), gid_map: readOrNull("/proc/self/gid_map") },
    sockets: null
  };
  if (!onGithubHostedRunner()) {
    out.socketsSkipped = "GitHub 제공 실행기가 아니므로 소켓 검사를 하지 않음";
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  }
  out.sockets = {};
  for (const spec of SERVICE_SOCKETS) out.sockets[spec.name] = checkSocket(spec);
  // 추상 소켓: 시험이 직접 연 자기 소켓(이름 무작위)에만 접속해 본다. 외부 서비스가 아니다.
  if (abstractArg) out.abstract = await connectOnly("\0" + abstractArg.slice("--abstract=".length));
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}
