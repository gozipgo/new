# Comrade Chat

> For the real Comrade

3~5명이 쓰는 아주 단순한 실시간 채팅 웹앱입니다. 방 목록도, 회원가입도 없이 **"닉네임 + 공유 비밀번호 하나"** 로 들어가는 단일 채팅방입니다.

- 텍스트 + 이미지만 주고받기 (파일/음성/영상/이모지 피커 없음)
- 다크/라이트 테마, 모바일 반응형
- 관리자 화면(`/admin`)에서 접속자 목록·로그인 시도 기록 확인, 강제 퇴장, 기록 삭제

## 프로젝트 구조

```
.
├── package.json
├── server.js              # Express + Socket.IO 진입점
├── db.js                  # better-sqlite3 초기화/쿼리
├── auth.js                # 서명된 세션 쿠키 생성/검증
├── render.yaml            # Render 배포 설정 (Blueprint)
├── .env.example
├── .gitignore
├── README.md
├── data/                  # chat.db 저장 위치 (최초 실행 시 자동 생성)
├── uploads/               # 업로드된 이미지 (최초 실행 시 자동 생성)
├── views/
│   └── admin.html         # 관리자 페이지 (정적 서빙 대상이 아님 — /admin 인증을 거쳐야만 받을 수 있음)
└── public/
    ├── index.html         # 로그인 화면 + 채팅 화면 (한 페이지)
    ├── style.css
    ├── app.js
    ├── admin.css
    └── admin.js
```

## 로컬 실행

```bash
npm install
cp .env.example .env
# .env를 열어 SHARED_PASSWORD / ADMIN_PASSWORD / SESSION_SECRET 값을 직접 채워넣기
npm start
```

`http://localhost:3000` 접속 → 표시 이름과 공유 비밀번호 입력 → 입장.

관리자로 들어가려면 로그인 화면에서 **"관리자로 입장"** 을 체크하고 `ADMIN_PASSWORD`를 입력합니다. 입장 후 헤더의 톱니바퀴 아이콘 또는 `http://localhost:3000/admin`으로 관리자 화면에 접근할 수 있습니다.

> 로컬에서 `http://localhost`로 테스트할 때는 `.env`의 `NODE_ENV=production` 줄을 지우거나 `development`로 두세요. production이면 쿠키에 `secure` 플래그가 붙어 HTTP에서는 로그인이 유지되지 않습니다.

`SESSION_SECRET` 생성:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 배포 가이드 (Render 무료 플랜)

Render의 무료 Web Service는 `xxx.onrender.com` 형태의 주소를 무료로 붙여줍니다. 신용카드 등록 없이 가능합니다.

1. **GitHub에 코드 올리기**
   이 저장소를 그대로 쓰거나, 직접 올리려면:
   ```bash
   git init && git add . && git commit -m "init"
   git branch -M main
   git remote add origin https://github.com/<계정>/<저장소>.git
   git push -u origin main
   ```

2. **Render 계정 생성**
   [render.com](https://render.com)에서 GitHub 계정으로 가입/로그인합니다.

3. **저장소 연결**
   대시보드에서 **New + → Web Service** → 방금 올린 저장소 선택 → 연결 승인.
   (저장소에 `render.yaml`이 있으므로 **New + → Blueprint** 를 선택하면 아래 4번 설정이 자동으로 채워집니다.)

4. **빌드/실행 설정**
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: `Free`

5. **환경변수 설정**
   서비스의 **Environment** 탭에서 등록합니다:

   | 키 | 값 |
   |---|---|
   | `SHARED_PASSWORD` | 친구들과 공유할 비밀번호 |
   | `ADMIN_PASSWORD` | 나만 아는 관리자 비밀번호 |
   | `SESSION_SECRET` | 길고 무작위한 문자열 (위 명령으로 생성) |
   | `NODE_ENV` | `production` |

   `PORT`는 Render가 자동으로 주입하므로 설정하지 않습니다.

6. **배포 확인**
   Deploy가 끝나면 `https://<서비스이름>.onrender.com` 주소가 발급됩니다. 접속해서 로그인 → 메시지 전송 → 이미지 업로드까지 확인하세요. 이 주소를 친구들에게 그대로 공유하면 됩니다.

> **왜 로컬 IP로는 안 되나요?**
> `172.16.x.x`, `192.168.x.x`, `10.x.x.x`는 사설 IP라서 방화벽을 다 열어도 인터넷 건너편에서는 도달할 수 없습니다. 같은 와이파이/공유기 안에 있는 사람만 `http://<로컬IP>:3000`으로 접속할 수 있습니다. 외부의 친구와 쓰려면 위 배포가 필요합니다.

### 무료 플랜의 함정

- **콜드 스타트**: 15분간 트래픽이 없으면 컨테이너가 잠들고, 다음 접속 시 첫 응답이 30~50초 걸릴 수 있습니다. 그다음부터는 정상 속도입니다.
- **로컬 디스크 휘발성**: 무료 플랜은 재배포/재시작 시 파일시스템이 초기화되므로 `data/chat.db`(채팅 기록)와 `uploads/`(이미지)가 **날아갈 수 있습니다.**
  - **영구 디스크를 붙이려면**: 유료 플랜(Starter, 월 $7)으로 올린 뒤 **Settings → Disks** 에서 디스크를 `/var/data`에 마운트하고, 환경변수 `DATA_DIR=/var/data/db`, `UPLOAD_DIR=/var/data/uploads`를 추가하면 재시작 후에도 유지됩니다. (코드 수정 불필요)
  - **무료로 쓰려면**: "기록은 휘발성"으로 받아들이고 쓰면 됩니다. 어차피 서버는 최근 200건만 보관합니다.

### 내 도메인 연결하기

1. Render 서비스의 **Settings → Custom Domain**에서 원하는 도메인/서브도메인을 추가합니다.
2. Render가 알려주는 CNAME(또는 A) 레코드를 도메인 DNS 관리 화면(가비아/Cloudflare 등)에 등록합니다.
3. DNS 전파 후 Render가 무료 SSL 인증서를 자동 발급해 HTTPS로 서비스됩니다.
4. `NODE_ENV=production`이면 쿠키에 `secure`가 붙으므로 반드시 HTTPS 주소로 접속해야 로그인이 유지됩니다.

## 동작 규칙 요약

| 항목 | 값 |
|---|---|
| 세션 유지 기간 | 7일 (httpOnly, sameSite=lax, 배포 시 secure) |
| 로그인 실패 제한 | IP 기준 1분에 5회 |
| 메시지 전송 제한 | 소켓 기준 초당 3건 |
| 텍스트 최대 길이 | 2000자 |
| 보관 메시지 | 최근 200건 (초과분 자동 삭제) |
| 허용 이미지 형식 | png, jpeg, webp, gif |
| 이미지 리사이즈 | 브라우저에서 최대 1280px, JPEG 품질 0.8로 변환 |
| 이미지 최대 용량 | 2MB (브라우저·서버 이중 검사) |
| 강제 퇴장 | 10분간 재입장 차단 |

## 임의로 정한 설계 결정 사항

1. **닉네임 중복 처리**: 거부 대신 `이름-2`, `이름-3`처럼 자동으로 번호를 붙여 접속을 허용했습니다. 소켓이 실제로 연결되는 시점(로그인 성공 시점이 아니라)에 현재 접속자 목록과 비교해 판단합니다.
2. **관리자 로그인 UX**: 입력창을 하나만 유지하기 위해, "관리자로 입장" 토글을 켜면 공유 비밀번호 입력란이 관리자 비밀번호 입력란으로 완전히 바뀝니다(둘 다 입력받지 않음).
3. **이미지 파이프라인**: 브라우저에서 png/gif/webp를 포함한 모든 이미지를 캔버스로 JPEG(품질 0.8, 최대 1280px)로 변환한 뒤 업로드합니다. 요구된 리사이즈 규칙을 형식과 무관하게 일괄 적용한 것이며, 이로 인해 **움직이는 GIF는 정지 이미지로 저장**됩니다. 서버는 방어적으로 png/jpeg/gif/webp 매직 넘버를 모두 허용합니다.
4. **관리자 대시보드 실시간성**: REST 폴링 대신 관리자 전용 Socket.IO 연결(`?mode=admin`)로 접속자 변화·로그인 시도·통계를 서버가 즉시 push합니다. 이 모니터링 소켓은 채팅 참가자 목록이나 입장·퇴장 메시지에는 포함되지 않습니다.
5. **세션 저장 방식**: 별도 세션 스토어 없이 `{name, isAdmin, exp}`를 HMAC-SHA256으로 서명해 쿠키 값 자체에 담습니다. 구조가 단순해지고 서버를 재시작해도 로그인이 유지됩니다. 다만 이 방식은 서버가 토큰을 개별 폐기할 수 없어, 강제 퇴장은 별도의 10분 차단 목록(메모리)으로 처리합니다.
6. **업로드 이미지 접근 제어**: `/uploads/*`도 로그인 세션이 있어야 열립니다. 파일명이 UUID라 추측은 어렵지만, URL이 유출돼도 외부에서 열리지 않도록 이중으로 막았습니다.

## 보안 메모

- 비밀번호는 환경변수로만 관리하며 타이밍 세이프하게 비교합니다. 필수 환경변수(`SHARED_PASSWORD`, `ADMIN_PASSWORD`, `SESSION_SECRET`)가 없으면 서버가 시작되지 않습니다.
- 모든 사용자 입력은 `textContent`로만 렌더링합니다 (`innerHTML` 직접 대입 없음).
- CSP를 포함한 기본 보안 헤더를 설정합니다.
- 업로드 파일은 확장자/Content-Type이 아니라 **매직 넘버**로 형식을 판별하고, 용량도 서버에서 다시 검사합니다.
- 리버스 프록시 뒤 배포를 전제로 `trust proxy`를 켜고 `X-Forwarded-For`의 첫 값을 클라이언트 IP로 씁니다. Render 같은 플랫폼은 이 헤더를 자기 값으로 덮어쓰므로 신뢰할 수 있지만, 프록시 없이 직접 노출하면 클라이언트가 위조할 수 있습니다(관리자 화면의 IP 표시와 로그인 레이트리밋에만 영향).
- 지인 3~5명이 쓰는 캐주얼한 앱이라는 전제로, OAuth·JWT 리프레시·RBAC 같은 과한 설계는 의도적으로 넣지 않았습니다.

## 넣지 않은 것

읽음 표시, 타이핑 인디케이터, 푸시 알림, 검색, 멘션, 답글, 여러 채팅방 — 단순함이 최우선 요구사항이라 의도적으로 제외했습니다.
