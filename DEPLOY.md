# 오라클 무료 서버에 배포하기

순서: **① 가입 → ② 서버 만들기 → ③ 포트 열기 → ④ 배포 명령 한 번**
①~③은 오라클 웹사이트에서 직접 해야 하고(10~20분), ④는 Claude에게 IP만 알려주면 돼요.

> 서버 접속용 키는 이미 만들어 두었어요:
> - 공개 키(서버에 등록할 것): `C:\Users\shdbs\.ssh\oracle_travel.pub`
> - 개인 키(절대 남에게 주지 마세요): `C:\Users\shdbs\.ssh\oracle_travel`

---

## ① 오라클 클라우드 가입

1. https://www.oracle.com/cloud/free/ 에서 **무료로 시작하기**
2. **홈 리전**을 고를 때 **South Korea Central (Seoul)** 또는 **South Korea North (Chuncheon)** 을 고르세요.
   - 홈 리전은 **나중에 못 바꿔요.** 무료 서버는 홈 리전에서만 만들 수 있어요.
3. 카드 인증을 해요. 확인용 소액 승인 후 취소되고, 무료 범위 안에서는 요금이 나가지 않아요.

## ② 서버(인스턴스) 만들기

메뉴 ☰ → **컴퓨트(Compute)** → **인스턴스(Instances)** → **인스턴스 생성(Create instance)**

| 항목 | 설정 |
| --- | --- |
| 이름 | `travel-diary` |
| 이미지 | **이미지 변경** → **Canonical Ubuntu** → **24.04** |
| Shape | **Shape 변경** → **Ampere** → `VM.Standard.A1.Flex`, OCPU **1**, 메모리 **6GB** ("Always Free 적격" 표시 확인) |
| 네트워킹 | **새 가상 클라우드 네트워크 생성**, **공용 서브넷**, **공용 IPv4 주소 자동 할당: 켜기** |
| SSH 키 | **공개 키 파일(.pub) 업로드** → `C:\Users\shdbs\.ssh\oracle_travel.pub` 선택 |
| 부트 볼륨 | 기본값 그대로 |

**생성**을 누르고 상태가 **실행 중(Running)** 이 되면, 화면의 **공용 IP 주소**를 복사해 두세요.

> **"Out of capacity(용량 부족)" 오류가 나면**: 무료 ARM 서버는 인기가 많아서 자주 그래요.
> - 가용성 도메인(AD)을 바꿔서 다시 시도하거나, 몇 시간 뒤 다시 해보세요.
> - 그래도 안 되면 Shape를 **Specialty and previous generation** → `VM.Standard.E2.1.Micro`(AMD, 메모리 1GB)로 바꾸세요. 이 앱은 그걸로도 충분히 돌아가요.

## ③ 80, 443 포트 열기 (https 접속용)

1. 인스턴스 상세 화면 → **기본 VNIC**의 **서브넷** 이름 클릭
2. **보안 목록(Security Lists)** → `Default Security List for ...` 클릭
3. **수신 규칙 추가(Add Ingress Rules)** 를 두 번 해요:

| 소스 CIDR | IP 프로토콜 | 대상 포트 범위 |
| --- | --- | --- |
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

(서버 안쪽 방화벽은 배포 스크립트가 알아서 열어요.)

## ④ 배포

Claude에게 **"서버 IP는 123.45.67.89야"** 라고 알려주면 배포해 드려요.
직접 하려면 `travel_diary` 폴더의 PowerShell에서:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -ServerIp 123.45.67.89
```

- 끝나면 `https://123-45-67-89.sslip.io` 같은 주소가 나와요. 이 주소로 접속하고, 친구들에게도 이 주소(또는 초대 링크)를 보내면 돼요.
- `sslip.io`는 IP로 무료 주소를 만들어 주는 서비스예요. 내 도메인이 있으면 `-Domain travel.내도메인.com` 을 붙이세요. (도메인의 DNS A 레코드를 서버 IP로 먼저 연결해야 해요.)
- PC에서 쓰던 계정·기록·사진도 옮기려면 PC 서버를 끈 뒤 `-CopyLocalData` 를 붙이세요. 서버가 비어 있을 때만 옮겨지고, 서버 데이터를 덮어쓰지는 않아요.

---

## 배포한 뒤에

**앱을 고친 뒤 업데이트**: ④의 명령을 그대로 다시 실행하면 돼요. 데이터는 그대로 남아요.

**자동 백업**: 서버가 매일 `/var/backups/travel-diary/` 에 DB(14일치)와 사진(7일치)을 백업해요.
같은 서버 안에 있는 백업이라, 가끔은 PC로 받아두세요 (PowerShell):

```powershell
cmd /c "ssh -i %USERPROFILE%\.ssh\oracle_travel ubuntu@123.45.67.89 sudo tar -czf - -C /var/backups travel-diary > travel-backup.tar.gz"
```

**서버 상태 보기**:

```powershell
ssh -i $HOME\.ssh\oracle_travel ubuntu@123.45.67.89 "systemctl status travel-diary --no-pager; sudo journalctl -u travel-diary -n 50 --no-pager"
```

## 알아둘 점

- **주소가 IP에 묶여 있어요.** 서버를 지우고 새로 만들면 IP가 바뀌어서 주소와 초대 링크가 바뀌어요. 오래 쓸 거면 도메인(1년 1~2만 원)을 연결하는 걸 추천해요.
- **유휴 서버 회수**: 오라클은 무료 계정에서 7일 동안 거의 놀고 있는 서버를 회수할 수 있다고 안내해요. 걱정되면 계정을 **종량제(Pay As You Go)** 로 올리면 회수 대상에서 빠져요. 무료 범위 안에서는 그래도 0원이지만, 무료가 아닌 자원을 만들면 요금이 나가니 **예산 알림(Budgets)** 을 1달러로 걸어두세요.
- 지도 타일과 장소 검색은 OpenStreetMap의 무료 서버를 써요. 친구들끼리 쓰는 정도는 괜찮지만, 사용자가 아주 많아지면 유료 지도 서비스로 바꿔야 해요.
