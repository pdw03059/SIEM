// MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md)
/*
 * isolate.mjs — 네트워크 격리 공간에서 명령을 실행하는 방법을 고른다
 *
 * 방법 두 가지(보안 설정은 어느 쪽도 바꾸지 않는다):
 *   userns : unshare -rn            관리자 권한 없이 새 사용자·네트워크 공간을 만든다.
 *                                    Ubuntu 24.04 GitHub 실행기는 AppArmor 설정으로 이 방법을 막는다.
 *   sudo   : sudo -n unshare -n setpriv --reuid=<나> --regid=<나> --init-groups
 *                                    관리자 권한은 "네트워크 공간 만들기"에만 쓰고, 그 안에서 setpriv로
 *                                    즉시 원래 사용자로 돌아가 시험 명령을 실행한다(시험 프로그램은 관리자 권한으로 돌지 않음).
 *                                    sudo -n: 비밀번호를 묻지 않음 — 비밀번호가 필요한 환경이면 그냥 실패한다.
 * 선택: 환경 변수 MZK_ISOLATION = auto(기본) | userns | sudo
 *   auto는 userns를 먼저 시도하고, 안 되면 sudo를 시도한다. 둘 다 안 되면 null → 시험은 "판정 불가".
 *   CI는 어떤 방법이 쓰였는지 분명하게 하려고 값을 직접 지정한다.
 */
import { spawnSync } from "node:child_process";

/* 방법별 명령 앞부분 */
function prefixFor(method) {
  if (method === "userns") return ["unshare", "-rn"];
  if (method === "sudo") {
    const uid = String(process.getuid());
    const gid = String(process.getgid());
    return ["sudo", "-n", "unshare", "-n", "setpriv", `--reuid=${uid}`, `--regid=${gid}`, "--init-groups"];
  }
  return null;
}

/* 실제로 격리 공간에서 true 명령이 성공하는지 확인 */
function works(prefix) {
  const [cmd, ...args] = [...prefix, "true"];
  return spawnSync(cmd, args, { timeout: 15000 }).status === 0;
}

/* 쓸 수 있는 방법을 골라 { method, prefix } 또는 { method: null, reason }을 돌려준다 */
export function chooseIsolation(requested = process.env.MZK_ISOLATION || "auto") {
  const order = requested === "auto" ? ["userns", "sudo"] : [requested];
  const tried = [];
  for (const m of order) {
    const p = prefixFor(m);
    if (!p) { tried.push(`${m}: 알 수 없는 방법`); continue; }
    if (works(p)) return { method: m, prefix: p };
    tried.push(`${m}: 실패`);
  }
  return { method: null, prefix: null, reason: tried.join(", ") };
}
