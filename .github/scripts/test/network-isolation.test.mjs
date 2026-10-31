// MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md)
/*
 * network-isolation.test.mjs — 운영체제 수준 네트워크 격리 시험 (2단계)
 *
 * 무엇: 네트워크 격리 공간(harness/isolate.mjs가 고른 방법: unshare -rn 또는 sudo unshare -n + setpriv) 안팎에서
 *       같은 연결 시도를 한다.
 *   - 대조: 격리 밖에서는 각 경로가 연결돼야 한다. 연결되지 않으면 그 경로는 "판정 불가"(건너뜀, 통과 아님).
 *   - 차단: 격리 안에서는 모든 경로가 실패해야 한다. 하나라도 연결되면 실패.
 *   - 격리 확인: 격리 안의 네트워크 장치가 lo(자기 자신)뿐인지.
 *   - DNS 시도 확인: strace로 격리 안의 이름 조회가 실제로 이름 서버(53번 포트)에 연결을 시도했다가
 *     "네트워크 없음"으로 실패했는지 기록에서 확인(시도조차 안 한 실패와 구분).
 *   - 시험 장치 오프라인 확인: 회귀 시나리오(정상 흐름)를 격리 안에서 돌려도 정답과 같은지.
 * 한계: 대표 경로 10가지를 확인하는 시험이며, 가능한 모든 통신 방법을 증명하지는 않는다.
 *   GitHub Actions 실행기(Ubuntu 24.04)는 AppArmor 설정으로 unshare -rn을 막으므로 CI는 sudo 방법을 쓴다(보안 설정은 바꾸지 않음).
 *   격리 공간을 만들지 못하면 모든 격리 시험은 "판정 불가"(건너뜀)이며 통과로 세지 않는다.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import tls from "node:tls";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PROBE_NAMES, classify } from "./harness/net-probe.mjs";
import { SCENARIOS } from "./harness/scenarios.mjs";
import { runScenario } from "./harness/run-scenario.mjs";
import { chooseIsolation } from "./harness/isolate.mjs";
import { onGithubHostedRunner } from "./harness/local-probe.mjs";
import net from "node:net";
import crypto from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROBE = path.join(here, "harness", "net-probe.mjs");
const LOCAL_PROBE = path.join(here, "harness", "local-probe.mjs");
const ALLOWLIST = path.join(here, "harness", "socket-allowlist.json");
const INCONCLUSIVE = "판정 불가";
// MZK_REQUIRE_ISOLATION=1이면 판정 불가를 "건너뜀"이 아니라 "실패"로 처리한다(CI에서 판정 불가가 통과로 보이지 않게).
// 이 값은 워크플로에서 켜야 하며, 워크플로 변경은 발주자 별도 승인 대상이다(2026-10-31 기준 아직 켜지 않음).
const REQUIRE = process.env.MZK_REQUIRE_ISOLATION === "1";
function inconclusive(t, msg) {
  if (REQUIRE) assert.fail(`${msg} (MZK_REQUIRE_ISOLATION=1이므로 실패 처리)`);
  return t.skip(msg);
}

/* ---- 도우미: 탐침 실행(격리 여부 선택) ---- */
function probe(isolate, names = []) {
  const base = [process.execPath, PROBE, ...names];
  const [cmd, ...args] = isolate ? [...iso.prefix, ...base] : base;
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 60000 });
  if (r.error || r.status !== 0) return { error: r.error?.code || r.stderr || `exit ${r.status}` };
  return JSON.parse(r.stdout);
}

/* ---- 판정 기준 시험: 인증서 검증 오류만 "닿음", 그 밖의 TLS·네트워크 오류는 "실패" (격리 여부와 무관하게 항상 실행) ---- */
test("판정 기준: 인증서 검증 오류(정확히 일치하는 코드)만 연결됨으로 본다", () => {
  for (const code of ["ERR_TLS_CERT_ALTNAME_INVALID", "DEPTH_ZERO_SELF_SIGNED_CERT", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"]) {
    assert.equal(classify({ code }).ok, true, code);
    assert.equal(classify({ cause: { code } }).ok, true, `fetch 형식(cause): ${code}`);
  }
});

test("판정 기준: 인증서를 받았다는 증거가 없는 TLS 오류와 네트워크 오류는 실패로 본다", () => {
  const notReached = [
    "ERR_TLS_INVALID_PROTOCOL_VERSION", "ERR_TLS_HANDSHAKE_TIMEOUT", "ERR_TLS_INVALID_CONTEXT",
    "ERR_SSL_WRONG_VERSION_NUMBER", "ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE",
    "ERR_TLS_CERT_ALTNAME_INVALID_X", "CERT_", "UNABLE_TO_", // 앞부분만 같은 가짜 코드도 실패여야 함
    "ENETUNREACH", "ECONNREFUSED", "EAI_AGAIN", "ETIMEDOUT", "TIMEOUT"
  ];
  for (const code of notReached) assert.equal(classify({ code }).ok, false, code);
});

/* ---- 판정 기준 실측: 내 컴퓨터 안(127.0.0.1)에서 실제 상황을 만들어 분류가 맞는지 확인 ----
 * 외부 네트워크는 쓰지 않는다. 자체 서명 인증서는 시험할 때마다 임시 폴더에 새로 만들고 지운다(저장소에 키를 두지 않음).
 *   (1) 자체 서명 인증서 서버에 접속 → 인증서를 실제로 받은 뒤 검증 오류 → "닿음"이어야 함
 *   (2) 아무도 듣지 않는 포트에 접속 → 연결 거부 → "실패"여야 함
 *   (3) 접속 전 로컬 설정 오류(존재하지 않는 TLS 버전 "TLSv9" 지정) → ERR_TLS_로 시작하지만 서버에 닿지 않음 → "실패"여야 함
 *       서버가 듣고 있는 포트로 시도해서, 닿을 수 있는데도 로컬 오류로 끝난다는 것을 보인다.
 *       예전 규칙(ERR_TLS_ 앞부분 일치)이었다면 (3)을 "닿음"으로 잘못 판정했을 것임을 함께 확인한다. */
function tlsAttempt(options) {
  return new Promise(resolve => {
    try {
      const s = tls.connect(options, () => { s.destroy(); resolve({ connected: true }); });
      s.on("error", e => resolve({ error: e }));
    } catch (e) {
      resolve({ error: e }); // 설정 오류는 연결 시도 전에 바로 던져진다
    }
  });
}

test("판정 기준 실측: 인증서 오류=닿음, 연결 거부·로컬 설정 오류=실패", async t => {
  const hasOpenssl = spawnSync("openssl", ["version"]).status === 0;
  if (!hasOpenssl) return t.skip(`${INCONCLUSIVE}: openssl 없음`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mzk-tls-"));
  try {
    const gen = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
      "-subj", "/CN=mzk-test", "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem")]);
    assert.equal(gen.status, 0, "시험용 인증서 생성 실패");
    const server = tls.createServer({ key: fs.readFileSync(path.join(dir, "k.pem")), cert: fs.readFileSync(path.join(dir, "c.pem")) }, s => s.end());
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;

    const selfSigned = await tlsAttempt({ host: "127.0.0.1", port, servername: "mzk-test" });
    const local = await tlsAttempt({ host: "127.0.0.1", port, minVersion: "TLSv9" }); // 서버는 듣는 중, 로컬 설정 오류
    await new Promise(r => server.close(r));
    const closed = await tlsAttempt({ host: "127.0.0.1", port }); // 서버를 닫은 뒤 같은 포트 → 연결 거부

    assert.equal(selfSigned.error?.code, "DEPTH_ZERO_SELF_SIGNED_CERT");
    assert.equal(classify(selfSigned.error).ok, true, "인증서를 받은 경우는 닿음이어야 함");
    assert.equal(closed.error?.code, "ECONNREFUSED");
    assert.equal(classify(closed.error).ok, false, "연결 거부는 실패여야 함");
    assert.match(local.error?.code ?? "", /^ERR_TLS_/, "로컬 설정 오류도 ERR_TLS_로 시작함(예전 규칙의 오판 사례)");
    assert.equal(classify(local.error).ok, false, "로컬 설정 오류는 실패여야 함");
    t.diagnostic(`자체 서명: ${selfSigned.error.code} → 닿음 / 닫힌 포트: ${closed.error.code} → 실패 / 로컬 설정: ${local.error.code} → 실패`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// 격리 방법 고르기(못 고르면 이 파일의 격리 시험은 전부 판정 불가)
const iso = chooseIsolation();
const canIsolate = iso.method !== null;
const NO_ISO = `${INCONCLUSIVE}: 격리 공간을 만들 수 없음(${iso.reason})`;

const outside = probe(false);
const inside = canIsolate ? probe(true) : null;

/* ---- 권한 확인: 격리 안 시험 프로그램이 불필요한 권한을 갖지 않는지(방법별로 기준이 다름) ---- */
function localProbe(extraArgs = []) {
  // sudo는 환경 변수를 지우므로, 실행 위치 확인 값 두 개만 env로 명시해서 넘긴다(보안 근거가 아니라 실행 위치 제한용)
  const envPass = ["env", `GITHUB_ACTIONS=${process.env.GITHUB_ACTIONS ?? ""}`, `RUNNER_ENVIRONMENT=${process.env.RUNNER_ENVIRONMENT ?? ""}`];
  const [cmd, ...args] = [...iso.prefix, ...envPass, process.execPath, LOCAL_PROBE, ...extraArgs];
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 60000 });
  if (r.error || r.status !== 0) return { error: r.error?.code || r.stderr || `exit ${r.status}` };
  return JSON.parse(r.stdout);
}
const lp = canIsolate ? localProbe() : null;
const ZERO_CAP = "0000000000000000";

test("권한 확인: 격리 안 시험 프로그램의 사용자·그룹·capability·NoNewPrivs", t => {
  if (!canIsolate) return inconclusive(t, NO_ISO);
  assert.ok(!lp.error, `권한 탐침 실행 실패: ${lp.error}`);
  const st = lp.status;
  const uid = String(process.getuid()), gid = String(process.getgid());
  t.diagnostic(`격리 방법: ${iso.method} | Uid ${st.Uid} | Gid ${st.Gid} | Groups "${st.Groups}" | CapEff ${st.CapEff} | NoNewPrivs ${st.NoNewPrivs}`);
  assert.equal(st.NoNewPrivs, "1", "NoNewPrivs가 켜져 있지 않음");
  assert.equal(st.CapAmb, ZERO_CAP, "ambient capability가 남아 있음");
  if (iso.method === "sudo") {
    // sudo 방법: setpriv로 원래 사용자로 되돌아왔는지 — real·effective·saved·fs 4종 모두
    assert.deepEqual(st.Uid.split(/\s+/), [uid, uid, uid, uid], "uid 4종이 원래 사용자와 다름");
    assert.deepEqual(st.Gid.split(/\s+/), [gid, gid, gid, gid], "gid 4종이 원래 그룹과 다름");
    assert.equal(st.Groups, "", "추가 그룹이 남아 있음(--clear-groups 미적용)");
    for (const k of ["CapInh", "CapPrm", "CapEff"]) assert.equal(st[k], ZERO_CAP, `${k}가 0이 아님`);
  } else if (iso.method === "userns") {
    // 사용자 공간 방법: 안에서는 0번이지만, 밖에서 보면 원래 사용자 한 명에만 묶여 있어야 한다
    const um = lp.idmap.uid_map.trim().split(/\s+/), gm = lp.idmap.gid_map.trim().split(/\s+/);
    assert.deepEqual(um, ["0", uid, "1"], `uid_map이 "안의 0 = 밖의 원래 사용자 1명"이 아님: ${lp.idmap.uid_map}`);
    assert.deepEqual(gm, ["0", gid, "1"], `gid_map이 "안의 0 = 밖의 원래 그룹 1개"가 아님: ${lp.idmap.gid_map}`);
    t.diagnostic("userns 방법: capability는 새 사용자 공간 안에서만 유효(밖의 시스템에는 권한 없음)");
  } else {
    assert.fail(`알 수 없는 격리 방법: ${iso.method}`);
  }
});

/* ---- 추상 소켓: 시험이 격리 밖에 직접 연 자기 소켓에, 격리 안에서는 닿지 않아야 한다(실행기에서만) ---- */
test("추상 소켓: 격리 밖에서는 접속됨(대조) / 격리 안에서는 접속 안 됨", async t => {
  if (!canIsolate) return inconclusive(t, NO_ISO);
  if (!onGithubHostedRunner()) return t.skip("소켓 검사는 GitHub 제공 실행기에서만 수행(발주자 지시)");
  const name = `mzk-abstract-${crypto.randomBytes(6).toString("hex")}`;
  const server = net.createServer(c => c.destroy());
  await new Promise((res, rej) => { server.once("error", rej); server.listen("\0" + name, res); });
  try {
    const control = await new Promise(res => {
      const c = net.connect({ path: "\0" + name }, () => { c.destroy(); res(true); });
      c.on("error", () => res(false));
    });
    if (!control) return inconclusive(t, `${INCONCLUSIVE}: 격리 밖에서도 추상 소켓 접속 안 됨`);
    // 탐침은 별도 프로세스라 서버가 같은 이벤트 루프에서 응답할 수 있도록 비동기로 실행한다
    const { spawn } = await import("node:child_process");
    const envPass = ["env", `GITHUB_ACTIONS=${process.env.GITHUB_ACTIONS ?? ""}`, `RUNNER_ENVIRONMENT=${process.env.RUNNER_ENVIRONMENT ?? ""}`];
    const [cmd, ...args] = [...iso.prefix, ...envPass, process.execPath, LOCAL_PROBE, `--abstract=${name}`];
    const outText = await new Promise((res, rej) => {
      const ch = spawn(cmd, args); let buf = "";
      ch.stdout.on("data", d => (buf += d));
      ch.on("close", code => (code === 0 ? res(buf) : rej(new Error(`탐침 종료 코드 ${code}`))));
    });
    const r = JSON.parse(outText).abstract;
    assert.ok(r, "탐침이 추상 소켓 결과를 내지 않음");
    assert.notEqual(r.result, "connected", "격리 안에서 격리 밖의 추상 소켓에 접속됨 — 격리 실패");
    assert.notEqual(r.result, "error", `검사 오류(${r.code}) — 판정 불가를 통과로 처리하지 않음`);
    t.diagnostic(`격리 밖: 접속됨 / 격리 안: ${r.result}(${r.code})`);
  } finally {
    server.close();
  }
});

/* ---- 서비스 소켓 검사: 보고용(CI 성패와 분리, 발주자 결정). 결과는 실행 요약과 진단 출력에 남긴다 ---- */
test("[보고용] 서비스 소켓 6개 경로 — 파일 시스템 권한 기준 잠재적 접근 가능성", t => {
  if (!canIsolate) return t.skip(`${INCONCLUSIVE}: 격리 공간을 만들 수 없음(보고용 검사)`);
  if (!onGithubHostedRunner()) return t.skip("소켓 검사는 GitHub 제공 실행기에서만 수행(발주자 지시)");
  assert.ok(!lp.error, `탐침 실행 실패: ${lp.error}`);
  const allow = JSON.parse(fs.readFileSync(ALLOWLIST, "utf8")).allowed.map(a => a.path);
  const rows = Object.entries(lp.sockets).map(([n, r]) => {
    const verdict = r.exists === false ? "미존재" : r.note?.startsWith("검사 오류") ? "판정 불가"
      : r.writable ? (allow.includes(r.path) ? "허용 목록" : "발견 사항") : "통과";
    t.diagnostic(`[소켓] ${n} ${r.path}: ${r.note} → ${verdict}`);
    return `| ${n} | \`${r.path}\` | ${r.note} | ${verdict} |`;
  });
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, ["", `### [보고용] 서비스 소켓 검사 (Node ${process.version}, 격리 방법 ${iso.method})`,
      "| 이름 | 경로 | 결과 | 판정 |", "|---|---|---|---|", ...rows, ""].join("\n"));
  }
});

test("[보고용] journald 원격 로그 전달 설정 여부(설정 파일 읽기만)", t => {
  if (!onGithubHostedRunner()) return t.skip("GitHub 제공 실행기에서만 수행");
  const findings = [];
  const read = p => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
  const jd = read("/etc/systemd/journald.conf");
  if (jd && /^\s*ForwardToSyslog\s*=\s*yes/mi.test(jd)) findings.push("journald.conf: ForwardToSyslog=yes");
  for (const f of ["/etc/systemd/journal-upload.conf"]) if (read(f)) findings.push(`${f} 존재(원격 업로드 설정 가능성)`);
  const rs = [read("/etc/rsyslog.conf") ?? "", ...(() => { try { return fs.readdirSync("/etc/rsyslog.d").map(n => read(`/etc/rsyslog.d/${n}`) ?? ""); } catch { return []; } })()].join("\n");
  if (/^[^#\n]*(@@?[\w.\[\]:-]+|omfwd)/m.test(rs)) findings.push("rsyslog: 원격 전달 규칙(@, @@ 또는 omfwd) 있음");
  t.diagnostic(findings.length ? `[journald] 원격 전달 단서: ${findings.join("; ")}` : "[journald] 원격 전달 설정 단서 없음(읽을 수 있는 설정 파일 기준)");
});

test("허용 목록 규칙: 기본은 비어 있고, 금지 서비스 소켓은 들어갈 수 없으며, 항목마다 사유·근거가 있다", () => {
  const list = JSON.parse(fs.readFileSync(ALLOWLIST, "utf8")).allowed;
  for (const a of list) {
    assert.ok(a.path && a.reason && a.evidence, `허용 항목에 path·reason·evidence가 모두 있어야 함: ${JSON.stringify(a)}`);
    assert.ok(!/docker|dbus|resolve/.test(a.path), `금지된 소켓은 허용 목록에 넣을 수 없음: ${a.path}`);
  }
});
test("격리 공간 안의 네트워크 장치는 lo뿐이다", t => {
  if (!canIsolate) return inconclusive(t, NO_ISO);
  assert.ok(!inside.error, `격리 탐침 실행 실패: ${inside.error}`);
  assert.deepEqual(inside.interfaces, ["lo"]);
  assert.ok(outside.interfaces.some(i => i !== "lo"), "격리 밖에도 lo뿐이면 대조가 성립하지 않음");
});

for (const name of PROBE_NAMES) {
  test(`경로 ${name}: 격리 밖 연결됨(대조) / 격리 안 차단`, t => {
    if (!canIsolate) return inconclusive(t, NO_ISO);
    const o = outside.results[name];
    if (!o.ok) return inconclusive(t, `${INCONCLUSIVE}: 격리 밖에서도 연결 안 됨(${o.code})`);
    const i = inside.results[name];
    assert.equal(i.ok, false, `격리 안에서 ${name} 연결이 성공함 — 격리 실패`);
    t.diagnostic(`격리 밖: ${o.note ?? "연결됨"} / 격리 안: 차단(${i.code})`);
  });
}

test("DNS: 격리 안 이름 조회가 이름 서버 연결을 실제로 시도했다가 '네트워크 없음'으로 실패", t => {
  if (!canIsolate) return inconclusive(t, NO_ISO);
  const hasStrace = spawnSync("strace", ["-V"]).status === 0;
  if (!hasStrace) return inconclusive(t, `${INCONCLUSIVE}: strace 없음`);
  const [icmd, ...iargs] = iso.prefix;
  const r = spawnSync(icmd, [...iargs, "strace", "-f", "-e", "trace=connect,sendto,sendmmsg",
    process.execPath, PROBE, "dns-lookup", "dns-resolve"], { encoding: "utf8", timeout: 60000 });
  if (r.status !== 0) return inconclusive(t, `${INCONCLUSIVE}: strace 실행 실패(${r.stderr.split("\n")[0]})`);
  const lines = r.stderr.split("\n").filter(l => /htons\(53\)/.test(l));
  assert.ok(lines.length > 0, "53번 포트 연결 시도 기록이 없음 — 시도하지 않은 실패일 수 있음");
  assert.ok(lines.every(l => /ENETUNREACH/.test(l)), `53번 포트 시도 중 '네트워크 없음'이 아닌 결과가 있음:\n${lines.join("\n")}`);
  const res = JSON.parse(r.stdout).results;
  assert.equal(res["dns-lookup"].ok, false);
  assert.equal(res["dns-resolve"].ok, false);
  t.diagnostic(`53번 포트 연결 시도 ${lines.length}회, 모두 ENETUNREACH`);
});

test("시험 장치는 네트워크 없이 돈다: 정상 시나리오를 격리 안에서 실행해도 정답과 같다", t => {
  if (!canIsolate) return inconclusive(t, NO_ISO);
  const s = SCENARIOS.find(x => x.name === "01-normal");
  const golden = JSON.parse(fs.readFileSync(path.join(here, "golden", "01-normal.json"), "utf8"));
  const r = runScenario(s, undefined, { isolate: iso.prefix });
  assert.deepEqual({ description: s.description, ...r }, golden);
});
