# 네이버 메일 뷰어 (Node.js + IMAP)

네이버 메일함의 메일을 웹에서 확인할 수 있는 Node.js 애플리케이션입니다.

## 📋 사전 요구사항

- Node.js (v14 이상)
- npm 또는 yarn
- 네이버 메일 계정
- 네이버 메일 IMAP 설정 활성화

## 🔧 네이버 메일 IMAP 설정

사용 전 반드시 네이버 메일에서 IMAP을 활성화해야 합니다:

1. 네이버 메일(https://mail.naver.com) 접속
2. 우측 상단 **환경설정** 클릭
3. **POP3/IMAP 설정** 메뉴 선택
4. **IMAP/SMTP 설정** 선택
5. **확인** 버튼 클릭

## 🚀 설치 및 실행

### 1. 의존성 패키지 설치

```bash
npm install
```

### 2. 환경변수 설정 (선택사항)

환경변수를 사용하려면 `.env` 파일을 생성하세요:

```bash
# .env.example을 복사
cp .env.example .env

# .env 파일 편집
nano .env
```

**기본 실행 (환경변수 불필요):**

```bash
npm start
```

**환경변수 사용 실행:**

```bash
npm run start:env
```

### 3. 브라우저에서 접속

```
http://localhost:3000
```

## 🔐 환경변수 설정 (.env)

`.env` 파일 예제:

```env
# 서버 설정
PORT=3000
NODE_ENV=development

# CORS 설정
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# 로그 레벨
LOG_LEVEL=info
```

### 환경변수 상세 설명

| 변수명                    | 설명                               | 기본값                | 필수 |
| ------------------------- | ---------------------------------- | --------------------- | ---- |
| `PORT`                    | 서버 포트 번호                     | 3000                  | ❌   |
| `NODE_ENV`                | 실행 환경 (development/production) | development           | ❌   |
| `ALLOWED_ORIGINS`         | CORS 허용 도메인 (쉼표로 구분)     | http://localhost:3000 | ❌   |
| `RATE_LIMIT_WINDOW_MS`    | Rate Limit 시간 윈도우 (밀리초)    | 900000 (15분)         | ❌   |
| `RATE_LIMIT_MAX_REQUESTS` | Rate Limit 최대 요청 수            | 100                   | ❌   |
| `LOG_LEVEL`               | 로그 레벨                          | info                  | ❌   |

⚠️ **중요**: `.env` 파일에 실제 이메일 비밀번호를 저장하지 마세요!

## 📦 사용된 패키지

- **express**: 웹 서버 프레임워크
- **cors**: CORS 설정
- **imap**: IMAP 프로토콜 클라이언트
- **mailparser**: 이메일 파싱 라이브러리
- **dotenv**: 환경변수 관리
- **express-rate-limit**: API 요청 제한

## 🛠️ API 엔드포인트

### POST /api/fetch-emails

네이버 메일함에서 최근 메일을 가져옵니다.

**요청:**

```bash
curl -X POST http://localhost:3000/api/fetch-emails \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your_email@naver.com",
    "password": "your_password",
    "limit": 10
  }'
```

**응답:**

```json
{
  "success": true,
  "emails": [
    {
      "from": "sender@example.com",
      "subject": "메일 제목",
      "date": "Mon, 01 Jan 2024 12:00:00 +0900",
      "body": "메일 본문..."
    }
  ],
  "count": 10
}
```

### GET /api/health

서버 상태를 확인합니다.

**요청:**

```bash
curl http://localhost:3000/api/health
```

**응답:**

```json
{
  "status": "ok",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "environment": "development"
}
```

## 🔒 보안 주의사항

⚠️ **중요**: 이 애플리케이션은 데모/학습 목적입니다. 실제 프로덕션 환경에서 사용하려면:

### 기본 보안

1. ✅ **HTTPS 사용**: 암호화된 연결 필수
2. ✅ **환경변수 사용**: `.env` 파일로 설정 관리
3. ✅ **Rate Limiting**: API 요청 제한 (이미 구현됨)
4. ❌ **비밀번호 저장 금지**: 서버에 비밀번호 저장 금지

### 프로덕션 환경 추가 보안

1. **JWT 토큰 인증**: 세션 기반 인증 구현
2. **입력 검증**: 모든 사용자 입력 검증
3. **SQL Injection 방지**: 데이터베이스 사용 시
4. **XSS 방지**: 출력 이스케이프 처리
5. **CSRF 보호**: CSRF 토큰 구현
6. **보안 헤더**: Helmet.js 사용

### .env 파일 보안

```bash
# .env 파일은 절대 Git에 커밋하지 마세요!
# .gitignore에 추가되어 있는지 확인하세요

# .gitignore 내용 확인
cat .gitignore | grep .env
```

## 📝 사용 방법

### 웹 UI 사용

1. 브라우저에서 `http://localhost:3000` 접속
2. 네이버 이메일 주소 입력
3. 비밀번호 입력
4. 가져올 메일 개수 설정 (1-50)
5. "메일 가져오기" 버튼 클릭

### API 직접 호출

```javascript
// JavaScript/Node.js
const response = await fetch("http://localhost:3000/api/fetch-emails", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: "your_email@naver.com",
    password: "your_password",
    limit: 10,
  }),
});
const data = await response.json();
console.log(data);
```

```python
# Python
import requests

response = requests.post('http://localhost:3000/api/fetch-emails', json={
    'email': 'your_email@naver.com',
    'password': 'your_password',
    'limit': 10
})
print(response.json())
```

## 🐛 문제 해결

### "Invalid credentials" 오류

- ✅ 이메일/비밀번호 확인
- ✅ IMAP 설정이 활성화되어 있는지 확인
- ✅ 2단계 인증 사용 시 앱 비밀번호 사용

### 연결 오류

- ✅ 네트워크 연결 확인
- ✅ 방화벽 설정 확인 (993 포트)
- ✅ 네이버 메일 서버 상태 확인

### Rate Limit 오류

- ✅ 요청 빈도 줄이기
- ✅ `.env`에서 `RATE_LIMIT_MAX_REQUESTS` 증가

### 한글 깨짐

- ✅ 서버 재시작
- ✅ 브라우저 인코딩 UTF-8 확인

## 🚀 프로덕션 배포

### Heroku

```bash
# Heroku CLI 로그인
heroku login

# 앱 생성
heroku create your-app-name

# 환경변수 설정
heroku config:set NODE_ENV=production
heroku config:set PORT=3000

# 배포
git push heroku main
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### PM2 (프로세스 관리)

```bash
# PM2 설치
npm install -g pm2

# 앱 시작
pm2 start server-with-env.js --name naver-mail-viewer

# 자동 재시작 설정
pm2 startup
pm2 save
```

## 📚 참고 자료

- [네이버 메일 도움말](https://help.naver.com/service/5640/category/5643)
- [IMAP 프로토콜](https://tools.ietf.org/html/rfc3501)
- [Express.js 문서](https://expressjs.com/)
- [Node.js IMAP 라이브러리](https://github.com/mscdex/node-imap)
- [dotenv 문서](https://github.com/motdotla/dotenv)

## ⚖️ 라이선스

MIT

## ⚠️ 면책 조항

이 소프트웨어는 교육 목적으로 제공됩니다. 사용자는 네이버의 이용약관을 준수할 책임이 있습니다.
