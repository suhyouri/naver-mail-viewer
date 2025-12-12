require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Imap = require("imap");
const { simpleParser } = require("mailparser");
const nodemailer = require("nodemailer");

const app = express();

app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());

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

// 이메일 주소 추출
function extractEmail(from) {
  const match = from.match(/<(.+?)>/) || from.match(/([^\s<>]+@[^\s<>]+)/);
  return match ? match[1] : from;
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
            fromEmail: "",
            subject: "",
            date: "",
            body: "",
            uid: null,
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
                      emailData.fromEmail = extractEmail(value);
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

          msg.once("attributes", (attrs) => {
            emailData.uid = attrs.uid;
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

// 이메일 삭제 함수
function deleteEmail(email, password, uid) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: email,
      password: password,
      host: "imap.naver.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    imap.once("ready", () => {
      imap.openBox("INBOX", false, (err) => {
        if (err) {
          reject(err);
          return;
        }

        imap.addFlags(uid, ["\\Deleted"], (err) => {
          if (err) {
            reject(err);
            return;
          }

          imap.expunge((err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
            imap.end();
          });
        });
      });
    });

    imap.once("error", (err) => {
      reject(err);
    });

    imap.connect();
  });
}

// 이메일 전송 (원본 메일 내용을 사용자에게 전달)
// app.js의 sendEmail 함수를 이것으로 교체하세요
async function sendEmail(from, password, userEmail, originalEmail) {
  const transporter = nodemailer.createTransport({
    host: "smtp.naver.com",
    port: 465, // 기존 587에서 465로 변경 (중요!)
    secure: true, // 기존 false에서 true로 변경 (SSL 보안 접속)
    auth: {
      user: from,
      pass: password,
    },
    // 안정성을 위한 타임아웃 설정 추가
    connectionTimeout: 10000,
    greetingTimeout: 10000,
  });

  const mailOptions = {
    from: from,
    to: userEmail,
    subject: `[전달] ${originalEmail.subject}`,
    text: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📧 전달된 메일
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

보낸 사람: ${originalEmail.from}
제목: ${originalEmail.subject}
날짜: ${originalEmail.date}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
메일 내용:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${originalEmail.body}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
이 메일은 자동으로 전달되었습니다.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `,
  };

  return await transporter.sendMail(mailOptions);
}

// API: 메일 가져오기
app.get("/api/fetch-emails", async (req, res) => {
  try {
    const email = process.env.TEST_EMAIL;
    const password = process.env.TEST_PASSWORD;
    const limit = parseInt(req.query.limit) || 10;

    if (!email || !password) {
      return res.status(400).json({
        error: "환경변수를 설정해주세요.",
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
    res.status(500).json({
      error: "메일을 가져오는데 실패했습니다.",
    });
  }
});

// API: 메일 전송 + 삭제
app.post("/api/send-email", async (req, res) => {
  try {
    const { userEmail, uid, emailIndex } = req.body;
    const from = process.env.TEST_EMAIL;
    const password = process.env.TEST_PASSWORD;

    if (!userEmail || !uid || emailIndex === undefined) {
      return res.status(400).json({
        error: "필수 정보가 누락되었습니다.",
      });
    }

    const originalEmail = {
      from: req.body.originalFrom,
      subject: req.body.originalSubject,
      date: req.body.originalDate,
      body: req.body.originalBody,
    };

    await sendEmail(from, password, userEmail, originalEmail);
    await deleteEmail(from, password, uid);

    res.json({
      success: true,
      message: "메일이 전달되었고 원본이 삭제되었습니다.",
    });
  } catch (error) {
    console.error("Send/Delete error:", error);
    res.status(500).json({
      error: "처리에 실패했습니다.",
    });
  }
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
        
        .alert-success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
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
        
        .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.5);
            animation: fadeIn 0.3s;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        
        .modal-content {
            background: white;
            margin: 15% auto;
            padding: 30px;
            border-radius: 15px;
            width: 90%;
            max-width: 500px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            animation: slideIn 0.3s;
        }
        
        @keyframes slideIn {
            from {
                transform: translateY(-50px);
                opacity: 0;
            }
            to {
                transform: translateY(0);
                opacity: 1;
            }
        }
        
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 2px solid #e0e0e0;
        }
        
        .modal-header h2 {
            color: #333;
            font-size: 1.5em;
        }
        
        .close {
            color: #aaa;
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
            transition: color 0.3s;
        }
        
        .close:hover {
            color: #000;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 8px;
            color: #333;
            font-weight: 600;
        }
        
        .form-group input {
            width: 100%;
            padding: 12px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 16px;
            font-family: inherit;
            transition: border 0.3s;
        }
        
        .form-group input:focus {
            outline: none;
            border-color: #667eea;
        }
        
        .modal-buttons {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
        }
        
        .btn {
            padding: 12px 30px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
        }
        
        .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        
        .btn-primary:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
        }
        
        .btn-secondary {
            background: #e0e0e0;
            color: #333;
        }
        
        .btn-secondary:hover {
            background: #d0d0d0;
        }
        
        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        
        .email-circle.deleting {
            animation: fadeOut 0.5s forwards;
        }
        
        @keyframes fadeOut {
            0% {
                opacity: 1;
                transform: scale(1);
            }
            100% {
                opacity: 0;
                transform: scale(0.8);
            }
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
            
            .modal-content {
                width: 95%;
                margin: 20% auto;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📧 네이버 메일 뷰어</h1>
            <p>메일을 클릭하여 내 이메일로 전달받으세요 (자동 삭제)</p>
        </div>
        
        <div class="controls">
            <label for="limit">가져올 개수:</label>
            <input type="number" id="limit" value="10" min="1" max="50">
            <button id="fetchBtn">🔄 메일 가져오기</button>
        </div>
        
        <div class="alert alert-error" id="errorAlert"></div>
        <div class="alert alert-success" id="successAlert"></div>
        
        <div class="loading" id="loading">
            <div class="spinner"></div>
            <p style="color: white; font-size: 1.2em;">메일을 가져오는 중...</p>
        </div>
        
        <div class="badge-container" id="badgeContainer">
            <div class="email-count-badge" id="emailCountBadge"></div>
        </div>
        
        <div class="email-grid" id="emailGrid"></div>
    </div>
    
    <div id="emailModal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h2>📧 메일 전달</h2>
                <span class="close" id="closeBtn">&times;</span>
            </div>
            <form id="replyForm">
                <div class="form-group">
                    <label for="userEmail">당신의 이메일을 입력해주세요.</label>
                    <input type="email" id="userEmail" placeholder="your_email@example.com" required>
                </div>
                <input type="hidden" id="replyTo">
                <input type="hidden" id="emailUid">
                <input type="hidden" id="emailIndex">
                <input type="hidden" id="originalFrom">
                <input type="hidden" id="originalSubject">
                <input type="hidden" id="originalDate">
                <input type="hidden" id="originalBody">
                <div class="modal-buttons">
                    <button type="button" class="btn btn-secondary" id="cancelBtn">취소</button>
                    <button type="submit" class="btn btn-primary" id="sendBtn">📤 내 이메일로 전달</button>
                </div>
            </form>
        </div>
    </div>
    
    <script src="/app.js"></script>
</body>
</html>
    `);
});

// 자바스크립트 파일 제공
app.get("/app.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.send(`
let currentEmails = [];

window.addEventListener('load', function() {
    fetchEmails();
    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById('fetchBtn').addEventListener('click', fetchEmails);
    document.getElementById('closeBtn').addEventListener('click', closeModal);
    document.getElementById('cancelBtn').addEventListener('click', closeModal);
    document.getElementById('replyForm').addEventListener('submit', sendReply);
    
    window.addEventListener('click', function(event) {
        const modal = document.getElementById('emailModal');
        if (event.target === modal) {
            closeModal();
        }
    });
    
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            closeModal();
        }
    });
}

async function fetchEmails() {
    const limit = document.getElementById('limit').value;
    const errorAlert = document.getElementById('errorAlert');
    const successAlert = document.getElementById('successAlert');
    const loading = document.getElementById('loading');
    const emailGrid = document.getElementById('emailGrid');
    const fetchBtn = document.getElementById('fetchBtn');
    const badgeContainer = document.getElementById('badgeContainer');
    
    errorAlert.style.display = 'none';
    successAlert.style.display = 'none';
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
            currentEmails = data.emails;
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
    
    emailGrid.innerHTML = '';
    
    emails.forEach(function(email, index) {
        const fromName = extractName(email.from || '알 수 없음');
        const subject = email.subject || '제목 없음';
        const date = formatDate(email.date);
        const body = email.body || '본문 없음';
        
        const circle = document.createElement('div');
        circle.className = 'email-circle';
        circle.id = 'email-' + index;
        circle.addEventListener('click', function() {
            openReplyModal(index);
        });
        
        const numberDiv = document.createElement('div');
        numberDiv.className = 'email-number';
        numberDiv.textContent = index + 1;
        
        const fromDiv = document.createElement('div');
        fromDiv.className = 'email-from';
        fromDiv.textContent = fromName;
        
        const subjectDiv = document.createElement('div');
        subjectDiv.className = 'email-subject';
        subjectDiv.textContent = subject;
        
        const dateDiv = document.createElement('div');
        dateDiv.className = 'email-date';
        dateDiv.textContent = date;
        
        const previewDiv = document.createElement('div');
        previewDiv.className = 'email-preview';
        previewDiv.textContent = body;
        
        circle.appendChild(numberDiv);
        circle.appendChild(fromDiv);
        circle.appendChild(subjectDiv);
        circle.appendChild(dateDiv);
        circle.appendChild(previewDiv);
        
        emailGrid.appendChild(circle);
    });
    
    emailGrid.style.display = 'grid';
}

function openReplyModal(index) {
    const email = currentEmails[index];
    const modal = document.getElementById('emailModal');
    
    document.getElementById('replyTo').value = email.fromEmail || extractEmailAddress(email.from);
    document.getElementById('emailUid').value = email.uid;
    document.getElementById('emailIndex').value = index;
    document.getElementById('userEmail').value = '';
    document.getElementById('originalFrom').value = email.from;
    document.getElementById('originalSubject').value = email.subject;
    document.getElementById('originalDate').value = email.date;
    document.getElementById('originalBody').value = email.body;
    
    modal.style.display = 'block';
}

function closeModal() {
    document.getElementById('emailModal').style.display = 'none';
}

async function sendReply(event) {
    event.preventDefault();
    
    const sendBtn = document.getElementById('sendBtn');
    const errorAlert = document.getElementById('errorAlert');
    const successAlert = document.getElementById('successAlert');
    
    const userEmail = document.getElementById('userEmail').value;
    const uid = document.getElementById('emailUid').value;
    const index = document.getElementById('emailIndex').value;
    const originalFrom = document.getElementById('originalFrom').value;
    const originalSubject = document.getElementById('originalSubject').value;
    const originalDate = document.getElementById('originalDate').value;
    const originalBody = document.getElementById('originalBody').value;
    
    errorAlert.style.display = 'none';
    successAlert.style.display = 'none';
    sendBtn.disabled = true;
    sendBtn.textContent = '📤 전달 중...';
    
    try {
        const response = await fetch('/api/send-email', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                userEmail: userEmail, 
                uid: uid,
                emailIndex: index,
                originalFrom: originalFrom,
                originalSubject: originalSubject,
                originalDate: originalDate,
                originalBody: originalBody
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || '처리에 실패했습니다.');
        }
        
        const emailElement = document.getElementById('email-' + index);
        if (emailElement) {
            emailElement.classList.add('deleting');
            
            setTimeout(function() {
                emailElement.remove();
                
                const remainingEmails = document.querySelectorAll('.email-circle').length;
                const emailCountBadge = document.getElementById('emailCountBadge');
                emailCountBadge.textContent = '📬 총 ' + remainingEmails + '개의 메일';
                
                if (remainingEmails === 0) {
                    document.getElementById('emailGrid').style.display = 'none';
                    document.getElementById('badgeContainer').style.display = 'none';
                }
            }, 500);
        }
        
        successAlert.textContent = '✅ ' + userEmail + ' 로 메일이 전달되고 원본이 삭제되었습니다!';
        successAlert.style.display = 'block';
        
        closeModal();
        
        setTimeout(function() {
            successAlert.style.display = 'none';
        }, 5000);
        
    } catch (error) {
        errorAlert.textContent = error.message;
        errorAlert.style.display = 'block';
    } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = '📤 내 이메일로 전달';
    }
}

function extractName(from) {
    const match = from.match(/"?([^"<]+)"?\s*<?/);
    if (match && match[1]) {
        return match[1].trim();
    }
    const emailMatch = from.match(/([^@<\s]+)@/);
    if (emailMatch && emailMatch[1]) {
        return emailMatch[1];
    }
    return from;
}

function extractEmailAddress(from) {
    const match = from.match(/<(.+?)>/) || from.match(/([^\s<>]+@[^\s<>]+)/);
    return match ? match[1] : from;
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
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║   📧 네이버 메일 뷰어 + 자동 삭제            ║
║   🌐 http://localhost:${PORT}                  ║
║   🗑️  제출 시 메일 자동 삭제                 ║
╚═══════════════════════════════════════════════╝
  `);
});

module.exports = app;
