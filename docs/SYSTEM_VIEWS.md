# SYSTEM_VIEWS — 통합 시스템 뷰 명세 (초안 v0.1)

원칙: 객체 하나의 상태를 보려고 여러 테이블을 조인하거나 외부 DB를 뒤지는 일이 없어야 한다. 객체 종류마다 `sys.<객체>` 뷰 **하나**가 이름·위치·상태·처리량·품질·의존 관계·운영 정보를 모두 담는다. 쿼리 언어·REST API·웹 UI·기본 대시보드는 모두 같은 뷰를 읽는다. (근거: docs/FIELD_NOTES.md, PLAN.md 9장)

공통 규칙
- 모든 뷰는 `id`(생성 시 부여, 절대 바뀌지 않는 UUID)와 `name`(사람이 바꿀 수 있는 이름)을 따로 둔다. 이름을 바꿔도 이력·대시보드·알림이 끊기지 않는다.
- 시각 컬럼은 UTC 저장, 화면은 사용자 시간대. `_at`=시각, `_sec`/`_ms`=시간 길이.
- 기간 집계는 `_1m`, `_5m`, `_1h`, `_today`, `_yesterday`, `_7d`, `_30d` 접미사로 통일.
- 모든 숫자 컬럼은 대시보드·알림 조건에 그대로 쓸 수 있다.
- 비밀값(비밀번호·토큰)은 어떤 뷰에도 나오지 않는다. 만료일·마지막 성공 시각만 노출.

## 1. sys.collectors — 수집기 (전체 명세)

### 1-1. 식별·분류
| 컬럼 | 설명 |
|---|---|
| id | 불변 UUID |
| name / display_name / description | 이름, 화면 표시명, 설명 |
| type | syslog_udp, syslog_tcp, syslog_tls, file_tail, dir_watch, sftp, ftp, db_query, windows_event, journald, snmp_trap, snmp_poll, netflow, sflow, ipfix, kafka, rest_poll, cloud_audit 등 |
| model / model_version | 수집 모델(수집 방식+파서+정규화 묶음) 이름과 버전 |
| parser / normalizer | 적용 파서, 정규화 규칙 |
| target_table | 적재 테이블 |
| group_path / tags | 그룹 트리 경로, 태그 목록 |
| owner / contact | 담당자, 장애 시 연락처 |
| created_at / created_by / updated_at / updated_by | 생성·변경 시각과 사람 |
| config_version / config_hash | 설정 버전, 설정 내용 해시(노드 간 설정 불일치 탐지용) |

### 1-2. 위치(어디서 돌고 어디로 가는가)
| 컬럼 | 설명 |
|---|---|
| node_name / node_id | 수집기가 **생성된(소속) 노드**의 이름과 ID |
| run_node_name | **지금 실제로 실행 중인** 노드(이중화·인계 후 바뀔 수 있음) |
| store_node_name | 데이터를 적재하는 노드 |
| node_role | active / standby / forwarder / agent |
| agent_host / agent_id / agent_version / agent_os | 원격 에이전트 수집기일 때 호스트명·ID·버전·OS |
| forward_path | 에이전트 → 전달 서버 → 분석 노드 실제 경로(예: `agent-07 → fwd-02 → active-01`) |
| listen_proto / listen_port | 수신형 수집기의 프로토콜·포트 |
| source_filter | 받는 대상 IP·대역·범위 |
| source_count_24h / unknown_sources_24h | 24시간 동안 실제로 보낸 송신지 수, 미등록 송신지 수 |
| timezone | 원본 로그 시간대 |

### 1-3. 상태·건강
| 컬럼 | 설명 |
|---|---|
| enabled | 켜짐/꺼짐 |
| state / state_since | running, stopped, failed, retrying, idle, **no_data** / 그 상태가 된 시각 |
| state_reason | 마지막 상태 변경 사유(사람이 끔, 연결 실패, 인증 실패, 디스크 부족 등) |
| health / health_reasons | ok·warn·crit와 그 이유 목록(한 줄 요약) |
| restart_count_24h | 24시간 재시작 횟수(깜빡임 감지) |
| last_error / last_error_at / error_count_1h / error_count_24h | 마지막 오류 내용·시각, 오류 횟수 |
| maintenance_until | 점검 예정 시각까지 알림 억제 |
| open_alerts / open_tickets | 열려 있는 알림·티켓 수 |

### 1-4. 수집량
| 컬럼 | 설명 |
|---|---|
| eps_1m / eps_5m / eps_1h | 초당 건수(1분·5분·1시간 평균) |
| bps_1m | 초당 바이트 |
| eps_peak_24h / eps_peak_24h_at | 24시간 최대 초당 건수와 그 시각 |
| events_today / bytes_today | 오늘 누적 건수·바이트 |
| events_yesterday / bytes_yesterday | 어제 건수·바이트 |
| **daily_avg_events_7d / daily_avg_bytes_7d** | **최근 7일 일평균** 건수·바이트 |
| **daily_avg_events_30d / daily_avg_bytes_30d** | **최근 30일 일평균** |
| daily_max_bytes_30d / daily_min_bytes_30d | 30일 중 최대·최소 일 수집량 |
| avg_event_size | 평균 로그 1건 크기 |
| stored_bytes_today / compression_ratio | 압축 후 저장 바이트, 압축률 |
| total_events / total_bytes | 생성 이후 누적 |
| ingest_share_pct | 전체 일 수집량 중 이 수집기 비중 |

### 1-5. 평소와 다른가(기준선·이상)
| 컬럼 | 설명 |
|---|---|
| baseline_eps_same_hour | 지난 4주 **같은 요일·같은 시각** 평균 |
| deviation_pct | 지금과 기준선의 차이(%) |
| volume_anomaly | none / spike(급증) / drop(급감) / **silence(끊김)** |
| silence_sec | 마지막 수신 후 경과 시간 |
| expected_silence_max_sec | 이 수집기가 평소 쉬는 최대 시간(학습값). 넘으면 끊김 판정 |
| missed_runs_24h | 주기 수집기(SFTP·DB·API)가 놓친 실행 횟수 |

### 1-6. 시간 품질
| 컬럼 | 설명 |
|---|---|
| last_received_at | 마지막 수신 시각(서버 기준) |
| last_event_time | 마지막 로그의 원본 시각 |
| source_lag_sec / source_lag_p95_sec | 원본 시각과 수신 시각 차이, 95% 구간 |
| clock_skew_sec | 원본 장비 시계 추정 오차 |
| future_events_24h / past_events_24h | 미래·과거 시각 로그로 **격리된** 건수(미래 날짜 파티션 생성 방지) |

### 1-7. 데이터 품질
| 컬럼 | 설명 |
|---|---|
| parse_ok_rate_1h | 파싱 성공률 |
| parse_fail_24h / parse_fail_sample_id | 파싱 실패 건수, 실패 예시 1건의 참조 ID(원문은 권한자만) |
| filtered_24h | 수집 필터로 버린 건수 |
| dropped_queue_full_24h | 대기열이 차서 버린 건수(**유실**) |
| udp_kernel_drops_24h | 운영체제 소켓 버퍼 초과로 커널이 버린 UDP 건수(**보이지 않던 유실**) |
| duplicates_24h / truncated_24h / encoding_errors_24h | 중복, 잘림, 문자 인코딩 오류 |
| multiline_merged_24h | 멀티라인으로 합쳐진 건수 |
| recv_vs_stored_diff_24h | 받은 건수 − 저장된 건수(0이 아니면 **유실 의심**) |

### 1-8. 전달·적재(밀림 추적)
| 컬럼 | 설명 |
|---|---|
| buffer_bytes / buffer_pct | 디스크 버퍼 사용량·사용률 |
| buffer_oldest_age_sec | 버퍼에 가장 오래 남은 로그의 대기 시간(**밀림의 핵심 지표**) |
| forward_lag_sec | 전달 지연 |
| retransmits_24h | 재전송 횟수 |
| write_queue_depth | 대상 테이블 쓰기 대기열 길이(테이블별 격리) |
| write_wait_reason | 대기 이유(잠금 대기·디스크 지연·복제 대기 등) |
| write_latency_p95_ms | 쓰기 지연 95% 구간 |
| last_written_at | 마지막으로 테이블에 써진 시각 |

### 1-9. 원천 연결(주기 수집형)
| 컬럼 | 설명 |
|---|---|
| checkpoint | 이어받을 위치(파일 오프셋, DB 기준 컬럼 값, SFTP 마지막 파일명, Kafka 오프셋) |
| current_file / files_pending | 지금 읽는 파일, 대기 중인 파일 수 |
| rotation_detected_at | 로그 회전 감지 시각 |
| connection_profile | 사용하는 접속 프로파일 이름 |
| last_connect_ok_at / auth_fail_24h | 마지막 접속 성공, 인증 실패 횟수 |
| **credential_expires_at** | 비밀번호·토큰 **만료 예정일**(만료 전에 미리 경고) |
| tls_cert_expires_at | TLS 인증서 만료일 |

### 1-10. 자원
| 컬럼 | 설명 |
|---|---|
| cpu_pct / mem_bytes / fd_count / threads | 이 수집기가 쓰는 CPU·메모리·파일 핸들·스레드 |

### 1-11. 의존 관계(멈추면 무엇이 영향받나)
이 수집기의 데이터를 **직접·간접으로** 쓰는 모든 객체를 자동 추적한다(아래 2-1 sys.dependencies의 결과를 요약).
| 컬럼 | 설명 |
|---|---|
| dep_total | 영향받는 객체 총수(간접 포함) |
| dep_scenarios | 실시간·배치 탐지 시나리오 |
| dep_scheduled_queries | 예약 쿼리 |
| dep_datasets | 데이터셋·조회 테이블(lookup)·요약 테이블 |
| dep_stream_queries | 스트림 쿼리(이 수집기 데이터를 가공해 다른 테이블로 보내는 것) |
| dep_profiles | 접속·행위 프로파일, 이상징후 모델의 학습 입력 |
| dep_dashboards / dep_widgets | 대시보드와 위젯 |
| dep_reports | 정기 보고서 |
| dep_alerts / dep_playbooks | 알림 규칙, 자동 대응(플레이북) |
| dep_explanations | 소명 워크플로(이 데이터로 소명 요청이 만들어지는 규칙) |
| dep_tables_downstream | 이 데이터가 가공돼 들어가는 하류 테이블 |
| dep_api_clients | 이 테이블을 조회하는 외부 API 키 |
| impact_level | 멈췄을 때 영향 등급(탐지 공백·법적 보관 위반·보고서 누락 등 가장 큰 것 기준) |
| compliance_tags | 법적 보관 의무 표시(예: 개인정보 접속기록 2년) |
| retention_days / storage_bytes / projected_storage_30d | 보존 기간, 사용 저장 공간, 30일 뒤 예상 |
| last_queried_at | 누군가 이 데이터를 마지막으로 조회한 시각(오래 안 쓰면 **비용 절감 후보**) |

### 1-12. 변경 이력
| 컬럼 | 설명 |
|---|---|
| change_count_30d / last_change_summary | 30일 설정 변경 횟수, 마지막 변경 요약(누가·무엇을) |

## 2. 다른 객체 뷰 (핵심 컬럼, 상세는 A·B·D·G단계에서 확장)
| 뷰 | 핵심 컬럼 |
|---|---|
| sys.nodes | node_name, role, version, uptime, cpu/mem/disk, **disk_full_eta**(디스크가 가득 찰 예상 시각), 시계 오차, 인증서 만료, 연결된 수집기·에이전트 수 |
| sys.agents | 호스트명, 버전, OS, 마지막 접속, **중복 ID 감지**(같은 ID로 여러 호스트가 접속하면 경고), 업그레이드 필요 여부 |
| sys.forwarders | 버퍼 사용률, 가장 오래된 대기 로그 나이, 전달 대상, 채널별 처리량, 재전송 |
| sys.tables | 일평균 수집량, 파티션 수, 미래 날짜 파티션 여부, 쓰기 대기열, **현재 잠금 보유자·대기자**, 보존 기간, 압축률 |
| sys.tables(저장 정책) | encryption(on/off)·key_id·key_rotated_at, compression_algo·level·ratio·cpu_pct, lifecycle_tier(hot/warm/cold/archive)·next_move_at, legal_hold, hash_chain_ok·last_verified_at, last_backup_at·backup_ok |
| sys.backups | 대상(테이블·노드·메타데이터), 종류(전체·증분), 시작·종료·소요, 크기, 저장 위치, 해시 검증 결과, 마지막 복원 시험 결과, 다음 예정, 백업 디스크 잔량·가득 찰 예상일 |
| sys.errors | 오류 코드, 심각도, 사람 말 요약, 영향, 원인 후보, 조치, 관련 객체 id·이름, 노드, 추적 ID, 처음·마지막 발생, 반복 횟수, 해결 여부, 기술 상세 |
| sys.integrations | 외부 연동별 대상 주소, 인증 방식, 주기, 마지막 성공·실패 시각, 가져온 건수, 실패 단계(DNS·프록시·TLS·인증·형식), 키 만료 예정일 |
| sys.integration_actions | 동작 이름, 조회/변경 구분, 호출 수, 성공률, 평균 응답 시간, 마지막 오류, 승인 대기 건수, 마지막 실행자 |
| sys.api_keys | 키 이름, 권한 범위, 만료일, 마지막 사용, 24시간 호출 수, 거부 수 |
| sys.locks | 잠금 종류, 보유 작업, 보유 시간, 대기 작업 목록(현장 장애의 원인 추적) |
| sys.queries | 실행 중 쿼리, 사용자, 시작 시각, 읽은 건수, 메모리, 취소 가능 여부 |
| sys.parsers | 사용 중 수집기 수, 성공률, 느린 정규식 경고 |
| sys.stream_queries | 처리량, 지연, 오류 격리 건수 |
| sys.schedules | 다음 실행, 마지막 실행 결과, **놓친 실행 수와 백필 필요 구간** |
| sys.scenarios | 실행 주기, 마지막 실행, 탐지 건수, 오탐 처리 비율, **입력 데이터 공백 여부**(원천 수집기가 멈췄는지), 입력 테이블·데이터셋·프로파일 목록(sys.dependencies) |
| sys.datasets | 데이터셋·조회 테이블: 크기, 마지막 갱신, 갱신 실패, 원천, 사용처 수 |
| sys.services | 내부 서비스별 상태와 서로의 의존 관계, 시작 실패 시 첫 원인 오류 |
| sys.profiles | 학습 기간, 마지막 학습, 기준선 대상 수 |
| sys.tickets / sys.explanations | 상태별 건수, 평균 처리 시간, 기한 초과, 소명 링크 **열람 확인 여부** |
| sys.users | 권한, 마지막 로그인, 비밀번호 만료, 휴면 계정 |
| sys.replication | 대기 노드와의 지연(건수·시간), 마지막 확인, 복제 중단 사유 |
| sys.license | 일 수집량 대비 한도, 30일 추세, 한도 초과 예상일 |
| sys.alerts / sys.audit | 열린 알림, 관리자 행위 감사 기록 |

## 2-1. sys.dependencies — 의존 관계 그래프(모든 객체 공통)
모든 객체 사이의 "누가 누구의 데이터를 쓰는가"를 한 표로 관리한다. 객체를 만들거나 쿼리·설정을 바꿀 때 **자동으로** 갱신된다(쿼리 언어의 테이블 참조를 파싱해 추출).
| 컬럼 | 설명 |
|---|---|
| from_type / from_id / from_name | 데이터를 내주는 쪽(수집기·테이블·데이터셋·스트림 쿼리·프로파일 등) |
| to_type / to_id / to_name | 데이터를 쓰는 쪽(시나리오·예약 쿼리·데이터셋·프로파일·대시보드·위젯·보고서·알림·플레이북·소명 규칙·하류 테이블·API 키) |
| relation | reads, writes, enriches(조회 테이블), trains(프로파일 학습), triggers(알림·플레이북) |
| depth | 직접 1, 간접 2 이상 |
| detected_at / last_used_at | 관계가 생긴 시각, 실제로 마지막 사용된 시각 |
사용처:
- **영향 분석**: 수집기·테이블·데이터셋을 끄거나 지우기 전에 "이걸 바꾸면 시나리오 7개, 예약 쿼리 3개, 프로파일 2개, 대시보드 5개가 영향받습니다" 경고와 목록을 보여 줌.
- **원인 역추적**: 시나리오가 탐지를 안 하면 거꾸로 따라가 입력 수집기의 끊김·지연을 바로 표시.
- **고아 객체 찾기**: 아무 데서도 안 쓰는 테이블·데이터셋·예약 쿼리 목록.
- 모든 sys.* 뷰의 `dep_*` 컬럼은 이 표를 요약한 값이다.

## 3. 자동 등록 기본 대시보드 — 수집기
수집기를 만들면 자동으로 아래에 나타나고, 삭제하면 사라진다.
1. **전체 현황판**: 상태별 수(정상·경고·위험·끊김·꺼짐), 오늘 총 수집량과 7일 일평균 대비, 상위 10개 수집기.
2. **수집기 지도**: 노드별로 묶은 타일. 색 = 건강 상태, 크기 = 일평균 수집량. 누르면 상세.
3. **끊김·급감 감시**: silence·drop 상태 수집기를 맨 위로. 의존 시나리오 수를 함께 표시해 급한 순서대로.
4. **밀림 감시**: 버퍼 가장 오래된 로그 나이, 쓰기 대기열, 대기 이유.
5. **유실 감시**: 대기열 초과 버림, 커널 UDP 버림, 받은 건수와 저장 건수의 차이.
6. **시간 품질**: 원본 지연, 시계 오차, 미래·과거 격리 건수.
7. **만료 예정**: 7·30일 안에 만료되는 비밀번호·토큰·인증서.
8. **수집기 상세 페이지**: 위 1-1~1-12 전 항목 + 24시간·30일 추이 그래프 + 최근 오류·변경 이력.
