require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Imap = require("imap");
const { simpleParser } = require("mailparser");
const rateLimit = require("express-rate-limit");

const app = express();

// CORS 설정
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : ["http://localhost:3000"];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(express.json());
app.use(express.static("public"));

// Rate Limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
});

app.use("/api/", limiter);

// 이메일 헤더 디코딩 함수
function decodeHeader(header) {
  if (!header) return "";

  const decoded = header.replace(
    /=\?([^?]+)\?([BQ])\?([^?]+)\?=/gi,
    (match, charset, encoding, text) => {
      try {
        if (encoding.toLowerCase() === "b") {
          return Buffer.from(text, "base64").toString("utf8");
        } else if (encoding.toLowerCase() === "q") {
          text = text.replace(/_/g, " ");
          return text.replace(/=([0-9A-F]{2})/gi, (match, hex) => {
            return String.fromCharCode(parseInt(hex, 16));
          });
        }
      } catch (e) {
        return match;
      }
      return match;
    }
  );

  return decoded;
}

// IMAP으로 이메일 가져오기
function fetchEmails(email, password, limit = 10) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: email,
      password: password,
      host: "imap.naver.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    const emails = [];

    imap.once("ready", () => {
      imap.openBox("INBOX", true, (err, box) => {
        if (err) {
          reject(err);
          return;
        }

        const totalMessages = box.messages.total;
        const start = Math.max(1, totalMessages - limit + 1);
        const end = totalMessages;

        if (totalMessages === 0) {
          imap.end();
          resolve([]);
          return;
        }

        const fetchRange = `${start}:${end}`;
        const f = imap.seq.fetch(fetchRange, {
          bodies: ["HEADER.FIELDS (FROM TO SUBJECT DATE)", "TEXT"],
          struct: true,
        });

        f.on("message", (msg, seqno) => {
          const emailData = {
            seqno: seqno,
            from: "",
            subject: "",
            date: "",
            body: "",
          };

          msg.on("body", (stream, info) => {
            let buffer = "";
            stream.on("data", (chunk) => {
              buffer += chunk.toString("utf8");
            });
            stream.once("end", () => {
              if (info.which === "TEXT") {
                simpleParser(buffer)
                  .then((parsed) => {
                    emailData.body = (
                      parsed.text ||
                      parsed.html ||
                      "본문 없음"
                    ).substring(0, 500);
                  })
                  .catch(() => {
                    emailData.body = buffer.substring(0, 500);
                  });
              } else {
                const lines = buffer.split("\r\n");
                lines.forEach((line) => {
                  const colonIndex = line.indexOf(":");
                  if (colonIndex > 0) {
                    const key = line.substring(0, colonIndex).toLowerCase();
                    const value = line.substring(colonIndex + 1).trim();

                    if (key === "from") {
                      emailData.from = decodeHeader(value);
                    } else if (key === "subject") {
                      emailData.subject = decodeHeader(value);
                    } else if (key === "date") {
                      emailData.date = value;
                    }
                  }
                });
              }
            });
          });

          msg.once("end", () => {
            emails.push(emailData);
          });
        });

        f.once("error", (err) => {
          reject(err);
        });

        f.once("end", () => {
          imap.end();
        });
      });
    });

    imap.once("error", (err) => {
      reject(err);
    });

    imap.once("end", () => {
      emails.sort((a, b) => b.seqno - a.seqno);
      resolve(emails);
    });

    imap.connect();
  });
}

// API 엔드포인트 - .env에서 자동으로 이메일/비밀번호 읽기
app.get("/api/fetch-emails", async (req, res) => {
  try {
    const email = process.env.TEST_EMAIL;
    const password = process.env.TEST_PASSWORD;
    const limit = parseInt(req.query.limit) || 10;

    if (!email || !password) {
      return res.status(400).json({
        error: ".env 파일에 TEST_EMAIL과 TEST_PASSWORD를 설정해주세요.",
      });
    }

    const emails = await fetchEmails(email, password, limit);

    res.json({
      success: true,
      emails: emails,
      count: emails.length,
    });
  } catch (error) {
    console.error("Error:", error);

    let errorMessage = "메일을 가져오는데 실패했습니다.";

    if (error.message.includes("Invalid credentials")) {
      errorMessage =
        "로그인 실패: 이메일 또는 비밀번호가 올바르지 않습니다. IMAP 설정이 활성화되어 있는지 확인해주세요.";
    } else if (
      error.message.includes("ENOTFOUND") ||
      error.message.includes("ETIMEDOUT")
    ) {
      errorMessage =
        "네트워크 연결 오류: 네이버 메일 서버에 연결할 수 없습니다.";
    }

    res.status(500).json({
      error: errorMessage,
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// 헬스 체크 엔드포인트
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

// 메인 페이지
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>네이버 메일 뷰어</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        
        .header {
            text-align: center;
            color: white;
            margin-bottom: 30px;
        }
        
        .header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
        }
        
        .controls {
            background: white;
            border-radius: 15px;
            padding: 20px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            margin-bottom: 30px;
            display: flex;
            gap: 15px;
            align-items: center;
            justify-content: center;
        }
        
        .controls label {
            color: #333;
            font-weight: 600;
        }
        
        .controls input {
            padding: 10px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 16px;
            width: 100px;
        }
        
        .controls button {
            padding: 10px 30px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s;
        }
        
        .controls button:hover:not(:disabled) {
            transform: translateY(-2px);
        }
        
        .controls button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        
        .alert {
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            display: none;
            text-align: center;
        }
        
        .alert-error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        
        .loading {
            text-align: center;
            padding: 40px 20px;
            display: none;
        }
        
        .spinner {
            border: 4px solid #f3f3f3;
            border-top: 4px solid #667eea;
            border-radius: 50%;
            width: 50px;
            height: 50px;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .email-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 20px;
            display: none;
        }
        
        .email-circle {
            background: white;
            border-radius: 50%;
            width: 300px;
            height: 300px;
            padding: 30px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            text-align: center;
            transition: transform 0.3s, box-shadow 0.3s;
            cursor: pointer;
            position: relative;
            overflow: hidden;
        }
        
        .email-circle:hover {
            transform: translateY(-10px) scale(1.05);
            box-shadow: 0 15px 40px rgba(0,0,0,0.3);
        }
        
        .email-circle::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
        }
        
        .email-number {
            position: absolute;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            width: 35px;
            height: 35px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 14px;
        }
        
        .email-from {
            color: #667eea;
            font-weight: 700;
            font-size: 14px;
            margin-bottom: 12px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 100%;
        }
        
        .email-subject {
            font-size: 16px;
            color: #333;
            margin-bottom: 10px;
            font-weight: 600;
            overflow: hidden;
            text-overflow: ellipsis;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            line-height: 1.4;
        }
        
        .email-date {
            color: #999;
            font-size: 12px;
            margin-bottom: 15px;
        }
        
        .email-preview {
            color: #666;
            font-size: 13px;
            line-height: 1.5;
            overflow: hidden;
            text-overflow: ellipsis;
            display: -webkit-box;
            -webkit-line-clamp: 4;
            -webkit-box-orient: vertical;
        }
        
        .email-count-badge {
            background: white;
            color: #667eea;
            padding: 15px 30px;
            border-radius: 50px;
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 20px;
            display: inline-block;
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        
        .badge-container {
            text-align: center;
            display: none;
        }
        
        @media (max-width: 768px) {
            .email-grid {
                grid-template-columns: 1fr;
            }
            
            .email-circle {
                width: 100%;
                height: auto;
                border-radius: 20px;
                padding: 25px;
            }
            
            .controls {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📧 네이버 메일 뷰어</h1>
            <p>자동으로 메일을 가져옵니다</p>
        </div>
        
        <div class="controls">
            <label for="limit">가져올 개수:</label>
            <input type="number" id="limit" value="10" min="1" max="50">
            <button onclick="fetchEmails()" id="fetchBtn">🔄 메일 가져오기</button>
        </div>
        
        <div class="alert alert-error" id="errorAlert"></div>
        
        <div class="loading" id="loading">
            <div class="spinner"></div>
            <p style="color: white; font-size: 1.2em;">메일을 가져오는 중...</p>
        </div>
        
        <div class="badge-container" id="badgeContainer">
            <div class="email-count-badge" id="emailCountBadge"></div>
        </div>
        
        <div class="email-grid" id="emailGrid"></div>
    </div>
    
    <script>
        // 페이지 로드 시 자동으로 메일 가져오기
        window.addEventListener('load', () => {
            fetchEmails();
        });
        
        async function fetchEmails() {
            const limit = document.getElementById('limit').value;
            const errorAlert = document.getElementById('errorAlert');
            const loading = document.getElementById('loading');
            const emailGrid = document.getElementById('emailGrid');
            const fetchBtn = document.getElementById('fetchBtn');
            const badgeContainer = document.getElementById('badgeContainer');
            
            errorAlert.style.display = 'none';
            emailGrid.style.display = 'none';
            badgeContainer.style.display = 'none';
            loading.style.display = 'block';
            fetchBtn.disabled = true;
            
            try {
                const response = await fetch('/api/fetch-emails?limit=' + limit);
                const data = await response.json();
                
                if (!response.ok) {
                    throw new Error(data.error || '메일을 가져오는데 실패했습니다.');
                }
                
                if (data.emails && data.emails.length > 0) {
                    displayEmails(data.emails);
                } else {
                    errorAlert.textContent = '메일이 없습니다.';
                    errorAlert.style.display = 'block';
                }
                
            } catch (error) {
                errorAlert.textContent = error.message;
                errorAlert.style.display = 'block';
            } finally {
                loading.style.display = 'none';
                fetchBtn.disabled = false;
            }
        }
        
        function displayEmails(emails) {
            const emailGrid = document.getElementById('emailGrid');
            const badgeContainer = document.getElementById('badgeContainer');
            const emailCountBadge = document.getElementById('emailCountBadge');
            
            emailCountBadge.textContent = '📬 총 ' + emails.length + '개의 메일';
            badgeContainer.style.display = 'block';
            
            let html = '';
            
            emails.forEach((email, index) => {
                const fromName = extractName(email.from || '알 수 없음');
                const subject = email.subject || '제목 없음';
                const date = formatDate(email.date);
                const body = email.body || '본문 없음';
                
                html += \`
                    <div class="email-circle">
                        <div class="email-number">\${index + 1}</div>
                        <div class="email-from">\${escapeHtml(fromName)}</div>
                        <div class="email-subject">\${escapeHtml(subject)}</div>
                        <div class="email-date">\${escapeHtml(date)}</div>
                        <div class="email-preview">\${escapeHtml(body)}</div>
                    </div>
                \`;
            });
            
            emailGrid.innerHTML = html;
            emailGrid.style.display = 'grid';
        }
        
        function extractName(from) {
            // 이메일에서 이름만 추출
            const match = from.match(/"?([^"<]+)"?\s*<?/);
            if (match && match[1]) {
                return match[1].trim();
            }
            // 이메일 주소만 있는 경우 @ 앞부분 추출
            const emailMatch = from.match(/([^@<\s]+)@/);
            if (emailMatch && emailMatch[1]) {
                return emailMatch[1];
            }
            return from;
        }
        
        function formatDate(dateStr) {
            if (!dateStr) return '';
            try {
                const date = new Date(dateStr);
                const now = new Date();
                const diff = now - date;
                const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                
                if (days === 0) {
                    const hours = Math.floor(diff / (1000 * 60 * 60));
                    if (hours === 0) {
                        const minutes = Math.floor(diff / (1000 * 60));
                        return minutes + '분 전';
                    }
                    return hours + '시간 전';
                } else if (days === 1) {
                    return '어제';
                } else if (days < 7) {
                    return days + '일 전';
                } else {
                    return date.toLocaleDateString('ko-KR');
                }
            } catch (e) {
                return dateStr;
            }
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    </script>
</body>
</html>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║                                               ║
║   📧 네이버 메일 뷰어 서버가 시작되었습니다!   ║
║                                               ║
║   🌐 http://localhost:${PORT}                  ║
║   📝 Environment: ${process.env.NODE_ENV || "development"}           ║
║                                               ║
╚═══════════════════════════════════════════════╝

✅ 준비 완료! 브라우저에서 위 주소로 접속하세요.

📧 .env 파일 설정:
   TEST_EMAIL=your_email@naver.com
   TEST_PASSWORD=xxxx-xxxx-xxxx-xxxx
    `);
});
