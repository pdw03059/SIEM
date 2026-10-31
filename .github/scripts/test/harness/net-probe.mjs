// MAZKION(마즈키온) — 성경 속 왕의 사관 '마즈키르(מַזְכִּיר, 삼하 8:16)' + 뿌리 '자카르(זָכַר, 기억하다)' + 빛보다 빠른 '-ion': "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자" (ORIGIN.md)
/*
 * net-probe.mjs — 대표 네트워크 경로로 실제 연결을 시도해 보고 결과를 JSON으로 출력
 *
 * 무엇: fetch, http, https(이름·IP 두 방식), net, tls, dns(두 방식), curl 각각으로 외부에 연결해 본다.
 *       결과는 { 경로: { ok: true } 또는 { ok: false, code: "오류 코드" } } 형태.
 *       네트워크 장치 목록(/proc/self/net/dev)도 함께 출력한다(격리 여부 확인용).
 * 왜: 네트워크 격리 시험에서 "격리 밖에서는 연결됨(대조), 격리 안에서는 모두 막힘"을 확인하려고.
 * 사용: node net-probe.mjs [경로...]   (경로를 주지 않으면 전부)
 * 한계: 대표 경로를 확인할 뿐, 가능한 모든 통신 방법을 증명하지는 않는다.
 * 대상 주소: 공개 서비스(api.github.com, 8.8.8.8 = Google 공개 DNS). 데이터는 보내지 않고 연결만 시험한다.
 */
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const TIMEOUT_MS = 5000; // 경로 하나당 최대 대기 시간
const HOST = "api.github.com";
const IP = "8.8.8.8"; // DNS 없이 IP로 직접 연결 시험(이름 조회 실패와 연결 실패를 구분하기 위해). 인증서에 IP가 들어 있어 https도 됨

/* ---- 1. 시도 하나를 제한 시간 안에서 실행하고 결과를 표준 형태로 바꾼다 ----
 * TLS 인증서 오류는 "상대 서버까지 연결은 성립했다"는 뜻이므로 연결됨(ok)으로 본다.
 * 이 시험이 보는 것은 "네트워크에 닿았는가"이지 인증서가 맞는가가 아니기 때문이다. */
const TLS_REACHED = /^(ERR_TLS_|CERT_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED)/;
function classify(e) {
  const code = e?.cause?.code || e?.code || String(e?.message || e);
  return TLS_REACHED.test(code) ? { ok: true, note: `TLS 인증서 오류(${code}) — 연결은 성립` } : { ok: false, code };
}
function attempt(fn) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve({ ok: false, code: "TIMEOUT" }), TIMEOUT_MS);
    const done = r => { clearTimeout(timer); resolve(r); };
    try {
      fn(() => done({ ok: true }), e => done(classify(e)));
    } catch (e) {
      done({ ok: false, code: e?.code || String(e?.message || e) });
    }
  });
}

/* ---- 2. 경로별 연결 시도: 응답이나 연결 성립을 "연결됨"으로 본다(HTTP 상태 코드는 상관없음) ---- */
const PROBES = {
  fetch: (ok, fail) => fetch(`https://${HOST}/`).then(ok, fail),
  http: (ok, fail) => http.get(`http://${HOST}/`, r => { r.resume(); ok(); }).on("error", fail),
  https: (ok, fail) => https.get(`https://${HOST}/`, { headers: { "User-Agent": "mzk-probe" } }, r => { r.resume(); ok(); }).on("error", fail),
  // IP 직접 연결: 이름 조회 없이도 막히는지 확인(이름 기반 경로는 DNS 단계에서 먼저 실패하기 때문)
  "fetch-ip": (ok, fail) => fetch(`https://${IP}/`).then(ok, fail),
  "https-ip": (ok, fail) => https.get(`https://${IP}/`, r => { r.resume(); ok(); }).on("error", fail),
  net: (ok, fail) => { const s = net.connect(443, IP, () => { s.destroy(); ok(); }); s.on("error", fail); },
  tls: (ok, fail) => { const s = tls.connect(443, IP, { servername: "dns.google" }, () => { s.destroy(); ok(); }); s.on("error", fail); },
  "dns-lookup": (ok, fail) => dns.lookup(HOST, e => (e ? fail(e) : ok())), // 운영체제 이름 조회(getaddrinfo)
  "dns-resolve": (ok, fail) => dns.resolve4(HOST, e => (e ? fail(e) : ok())), // Node 자체 DNS 질의(c-ares) — 경로가 다름
  curl: (ok, fail) => {
    const r = spawnSync("curl", ["-sS", "-o", "/dev/null", "--max-time", String(TIMEOUT_MS / 1000), `https://${HOST}/`], { encoding: "utf8" });
    if (r.error) fail(r.error); // curl이 없으면 ENOENT
    else if (r.status === 0) ok();
    else fail({ code: `CURL_EXIT_${r.status}` });
  }
};
export const PROBE_NAMES = Object.keys(PROBES);

/* ---- 3. 네트워크 장치 목록: /proc/self/net/dev는 현재 프로세스의 네트워크 공간 기준이다 ---- */
function interfaces() {
  try {
    return fs.readFileSync("/proc/self/net/dev", "utf8").split("\n").slice(2)
      .map(l => l.split(":")[0].trim()).filter(Boolean);
  } catch {
    return null; // 리눅스가 아니면 확인 불가
  }
}

/* ---- 4. 실행: 이 파일을 직접 실행했을 때만 동작(시험 코드가 불러올 때는 실행 안 함) ---- */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : PROBE_NAMES;
  const out = { interfaces: interfaces(), results: {} };
  for (const n of names) out.results[n] = await attempt(PROBES[n]);
  process.stdout.write(JSON.stringify(out));
  process.exit(0); // 열린 연결이 남아 있어도 바로 끝낸다
}
