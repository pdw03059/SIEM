// MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md)
/*
 * isolate.mjs — 네트워크 격리 공간에서 명령을 실행하는 방법을 고른다
 *
 * 이 격리의 목적(발주자 결정 2026-10-31): 시험 프로그램이 "실수로" 네트워크에 나가지 않는지 검증하는 것.
 *   악성 코드의 탈출을 막는 샌드박스가 아니다(그 요구사항은 docs/security/에 별도 기록).
 *
 * 방법 두 가지(보안 설정은 어느 쪽도 바꾸지 않는다):
 *   userns : unshare -rn setpriv --no-new-privs
 *            관리자 권한 없이 새 사용자·네트워크 공간을 만든다. 공간 안에서는 0번 사용자로 보이지만,
 *            uid_map이 "안의 0 = 밖의 원래 사용자"로 묶여 있어 밖에서는 아무 권한도 없다.
 *            Ubuntu 24.04 GitHub 실행기는 AppArmor 설정으로 이 방법을 막는다.
 *   sudo   : sudo -n unshare -n setpriv --reuid=<나> --regid=<나> --clear-groups --no-new-privs
 *            관리자 권한은 "네트워크 공간 만들기"에만 쓰고, 그 안에서 즉시 원래 사용자로 돌아간다.
 *            --clear-groups: 추가 그룹(예: docker 그룹) 제거, --no-new-privs: 이후 권한 획득 금지.
 *            sudo -n: 비밀번호를 묻지 않음 — 비밀번호가 필요한 환경이면 그냥 실패한다.
 * 선택: 환경 변수 MZK_ISOLATION = auto(기본) | userns | sudo
 *   auto는 userns를 먼저, 안 되면 sudo를 시도한다. 둘 다 안 되면 null → 시험은 "판정 불가".
 * 시험 전용: MZK_ISOLATION=fake-noop 은 "격리하지 않는 가짜 방법"이다. 격리 시험이 이 경우를 실제로
 *   잡아내는지(실패하는지) 확인하는 실패 시험(isolation-failure.test.mjs)에서만 쓴다.
 */
import { spawnSync } from "node:child_process";

const DEFAULT_COMMANDS = { unshare: "unshare", setpriv: "setpriv", sudo: "sudo" };

/* 방법별 명령 앞부분. commands로 실행 파일 경로를 바꿀 수 있다(실패 시험에서 가짜 명령을 넣기 위해) */
export function prefixFor(method, commands = DEFAULT_COMMANDS) {
  const c = { ...DEFAULT_COMMANDS, ...commands };
  if (method === "userns") return [c.unshare, "-rn", c.setpriv, "--no-new-privs"];
  if (method === "sudo") {
    const uid = String(process.getuid());
    const gid = String(process.getgid());
    return [c.sudo, "-n", c.unshare, "-n", c.setpriv, `--reuid=${uid}`, `--regid=${gid}`,
      "--clear-groups", "--no-new-privs"];
  }
  if (method === "fake-noop") return ["env"]; // 격리하지 않음(실패 시험 전용)
  return null;
}

/* 실제로 그 방법으로 true 명령이 성공하는지 확인 */
function works(prefix) {
  const [cmd, ...args] = [...prefix, "true"];
  return spawnSync(cmd, args, { timeout: 15000 }).status === 0;
}

/* 쓸 수 있는 방법을 골라 { method, prefix } 또는 { method: null, reason }을 돌려준다 */
export function chooseIsolation(requested = process.env.MZK_ISOLATION || "auto", commands = DEFAULT_COMMANDS) {
  const order = requested === "auto" ? ["userns", "sudo"] : [requested];
  const tried = [];
  for (const m of order) {
    const p = prefixFor(m, commands);
    if (!p) { tried.push(`${m}: 알 수 없는 방법`); continue; }
    if (works(p)) return { method: m, prefix: p };
    tried.push(`${m}: 실패`);
  }
  return { method: null, prefix: null, reason: tried.join(", ") };
}
