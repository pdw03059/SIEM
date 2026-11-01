# MAZKION

> **MAZKION(마즈키온)** — 성경 속 왕의 사관 *마즈키르*(מַזְכִּיר, 삼하 8:16) + *자카르*(זָכַר, 기억하다) + *-ion*(빛보다 빠른 입자). "모든 일을 빠짐없이, 가장 빠르게 기록하고 결코 잊지 않는 자." / *The one who records everything, fastest, and never forgets.* — [ORIGIN.md](ORIGIN.md)

High-performance open-source SIEM in C — agents, forwarders, analysis servers with HA, detection rules, case management and web UI.

C로 개발하는 고성능 오픈소스 SIEM — 에이전트, 전달 서버, 이중화 분석 서버, 탐지 룰, 케이스(소명) 관리, 웹 UI.

> **Status: early development (Stage 0).** See [PROGRESS.md](PROGRESS.md).

## Architecture / 구성

```
[Agent] ──TLS──▶ [Forwarder] ──TLS──▶ [Analysis Server (Active ⇄ Standby)] ◀── [Web UI]
 file · syslog ·    disk buffer ·         storage · index · query engine
 Windows events     retransmit ·          realtime & batch rules · anomaly detection
                    load balancing        tickets · case/explanation workflow · HA replication
```

## Design goals / 설계 목표

| Goal | Description |
|---|---|
| Fault isolation | Per-table write queues — one stalled table never blocks the others |
| No GC pauses | Core written in C with bounded, self-managed caches |
| Observability | Forwarding lag, lock holders and wait times exposed as live metrics |
| Safe upgrades | Automatic schema migration and config carry-over |
| Reliable scheduling | Scheduler health monitoring and built-in backfill (replay) of batch rules |
| Time sanity | Store by receive time; quarantine events with skewed device clocks |

## Performance targets / 성능 목표

- Single x86 server: **≥5.4 million UDP events/s** for receive + persist + index, with zero loss under the defined test window.
- Per node: **≥600 GB/day** while sustaining the defined concurrent search workload.
- Large search: at least 2.5 billion records, with response time **≤50% of the baseline** under identical conditions.
- These are engineering targets, **not achieved benchmark results**. Vendor reference figures have incomplete public test conditions; see [the benchmark protocol](docs/BENCHMARK_PLAN.md) and [architecture rationale](docs/ARCHITECTURE.md).
## Languages / 언어
- **C (C11)** — agent, forwarder, analysis server, web API
- **TypeScript + React** — web UI

Every line of C code carries a Korean comment so the codebase doubles as study material.
모든 C 코드에는 한 줄마다 한국어 주석을 달아 학습 자료로도 쓸 수 있게 합니다.

## Build (stage 1 prototype)
```sh
cd stage1 && make
./minilogd -p 5140 -d ./data          # UDP syslog receiver
./minilog-query -f 2026-10-30 -s error # query by date range and keyword
```

## License
[AGPL-3.0](LICENSE). Commercial licensing may be offered in the future.

## Contributing
Issues and ideas are welcome. A Contributor License Agreement (CLA) will be required before external pull requests are merged.
