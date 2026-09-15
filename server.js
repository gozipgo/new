// server.js
// Comrade Chat - 3~5인 전용 실시간 채팅 서버 (Express + Socket.IO + better-sqlite3)

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const http = require('http');
const { Server } = require('socket.io');

const {
  insertMessage,
  getRecentMessages,
  trimOldMessages,
  clearAllMessages,
  getTotalMessageCount,
  insertLoginAttempt,
  getRecentLoginAttempts,
  MAX_HISTORY,
} = require('./db');

const {
  COOKIE_NAME,
  createToken,
  verifyToken,
  timingSafeEqualStr,
  cookieOptions,
} = require('./auth');

const PORT = process.env.PORT || 3000;
const SHARED_PASSWORD = process.env.SHARED_PASSWORD;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const IS_PROD = process.env.NODE_ENV === 'production';

if (!SHARED_PASSWORD || !ADMIN_PASSWORD) {
  console.error(
    'SHARED_PASSWORD, ADMIN_PASSWORD 환경변수를 설정해야 합니다. .env.example을 참고하세요.'
  );
  process.exit(1);
}

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const app = express();
// 리버스 프록시(Render/Railway/Fly/Cloudflare) 뒤에서 실제 클라이언트 IP를 얻기 위해 필수
app.set('trust proxy', 1);

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e6, // 1MB. 이미지는 소켓이 아니라 REST 업로드로 처리하므로 넉넉함.
});

// ---------------------------------------------------------------------------
// 보안 헤더
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data: blob:",
      "media-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' ws: wss:",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
}

function getSocketIp(socket) {
  const xff = socket.handshake.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return socket.handshake.address || 'unknown';
}

function summarizeUserAgent(ua) {
  if (!ua) return 'unknown';
  return ua.length > 120 ? ua.slice(0, 120) + '…' : ua;
}

function nowMs() {
  return Date.now();
}

// ---------------------------------------------------------------------------
// 로그인 레이트리밋 (IP 기준, 1분에 5회)
// ---------------------------------------------------------------------------
const LOGIN_WINDOW_MS = 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const loginAttemptsByIp = new Map(); // ip -> timestamps[]

function isLoginRateLimited(ip) {
  const now = nowMs();
  const arr = (loginAttemptsByIp.get(ip) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
  loginAttemptsByIp.set(ip, arr);
  return arr.length >= LOGIN_MAX_ATTEMPTS;
}

function recordLoginRateLimitHit(ip) {
  const arr = loginAttemptsByIp.get(ip) || [];
  arr.push(nowMs());
  loginAttemptsByIp.set(ip, arr);
}

// ---------------------------------------------------------------------------
// 인증 미들웨어
// ---------------------------------------------------------------------------
function requireAuth(req, res, next) {
  const session = verifyToken(req.cookies[COOKIE_NAME]);
  if (!session) return res.status(401).json({ ok: false, error: 'unauthorized' });
  req.session = session;
  next();
}

function requireAdminPage(req, res, next) {
  const session = verifyToken(req.cookies[COOKIE_NAME]);
  if (!session || !session.isAdmin) return res.status(404).send('Not Found');
  req.session = session;
  next();
}

// 업로드된 이미지는 로그인한 사람만 볼 수 있게 한다.
// (파일명이 UUID라 추측은 어렵지만, URL이 유출돼도 외부에서 열리지 않도록 이중 방어)
app.use('/uploads', requireAuth, express.static(UPLOAD_DIR, { maxAge: '7d' }));

// ---------------------------------------------------------------------------
// 로그인 / 로그아웃 / 내 정보
// ---------------------------------------------------------------------------
app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.post('/api/login', (req, res) => {
  const ip = getClientIp(req);

  if (isLoginRateLimited(ip)) {
    return res.status(429).json({ ok: false, error: 'too_many_attempts' });
  }

  const body = req.body || {};
  const rawName = typeof body.displayName === 'string' ? body.displayName : '';
  const displayName = rawName.trim().slice(0, 20);
  const isAdminAttempt = !!body.isAdmin;
  const password = typeof body.password === 'string' ? body.password : '';

  const fail = (reason) => {
    recordLoginRateLimitHit(ip);
    insertLoginAttempt({ name: displayName || null, ip, success: false, createdAt: nowMs() });
    broadcastAdminSnapshot();
    return res.status(401).json({ ok: false, error: reason || 'invalid_credentials' });
  };

  // eslint-disable-next-line no-control-regex
  if (!displayName || /[\u0000-\u001f<>]/.test(displayName)) {
    return fail('invalid_name');
  }

  let isAdmin = false;
  if (isAdminAttempt) {
    if (!timingSafeEqualStr(password, ADMIN_PASSWORD)) return fail('invalid_credentials');
    isAdmin = true;
  } else {
    if (!timingSafeEqualStr(password, SHARED_PASSWORD)) return fail('invalid_credentials');
  }

  insertLoginAttempt({ name: displayName, ip, success: true, createdAt: nowMs() });
  broadcastAdminSnapshot();

  const token = createToken({ name: displayName, isAdmin });
  res.cookie(COOKIE_NAME, token, cookieOptions(IS_PROD));
  res.json({ ok: true, name: displayName, isAdmin });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ ok: true, name: req.session.name, isAdmin: req.session.isAdmin });
});

// ---------------------------------------------------------------------------
// 이미지 업로드
// ---------------------------------------------------------------------------
const ALLOWED_IMAGE_TYPES = new Set(['png', 'jpeg', 'gif', 'webp']);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB

// 매직 넘버로 실제 파일 형식 판별 (확장자/Content-Type 위조 방지)
function detectImageType(buffer) {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return 'gif';
  }
  if (
    buffer.length >= 12 &&
    buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    buffer.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
});

app.post('/api/upload', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'no_file' });
  }

  const detectedType = detectImageType(req.file.buffer);
  if (!detectedType || !ALLOWED_IMAGE_TYPES.has(detectedType)) {
    return res.status(400).json({ ok: false, error: 'unsupported_type' });
  }

  const declaredMime = req.file.mimetype || '';
  const mimeOk =
    (detectedType === 'jpeg' && declaredMime === 'image/jpeg') ||
    (detectedType === 'png' && declaredMime === 'image/png') ||
    (detectedType === 'gif' && declaredMime === 'image/gif') ||
    (detectedType === 'webp' && declaredMime === 'image/webp');

  if (!mimeOk) {
    return res.status(400).json({ ok: false, error: 'mime_mismatch' });
  }

  const ext = detectedType === 'jpeg' ? 'jpg' : detectedType;
  const filename = `${crypto.randomUUID()}.${ext}`;
  const filepath = path.join(UPLOAD_DIR, filename);

  fs.writeFile(filepath, req.file.buffer, (err) => {
    if (err) {
      console.error('이미지 저장 실패:', err);
      return res.status(500).json({ ok: false, error: 'save_failed' });
    }
    res.json({ ok: true, url: `/uploads/${filename}` });
  });
});

// multer 관련 에러(용량 초과 등) 처리
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ ok: false, error: 'upload_error', detail: err.code });
  }
  if (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
  next();
});

// ---------------------------------------------------------------------------
// 관리자 페이지 (데이터는 전부 Socket.IO로 실시간 전달, REST API는 페이지 서빙만 담당)
// ---------------------------------------------------------------------------
// admin.html은 public/이 아니라 views/에 두어, 정적 서빙으로 우회 접근되지 않게 한다.
app.get('/admin', requireAdminPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------
const connectedSockets = new Map(); // socketId -> { socketId, name, ip, connectedAt, lastActivity, userAgent, isAdmin }
const kickedUntil = new Map(); // 세션 이름 -> 재입장 허용 시각(ms). 쿠키가 살아있어도 즉시 재접속하는 것을 막는다.
const KICK_BLOCK_MS = 10 * 60 * 1000;

function isKicked(name) {
  const until = kickedUntil.get(name);
  if (!until) return false;
  if (nowMs() >= until) {
    kickedUntil.delete(name);
    return false;
  }
  return true;
}
const messageBucketsBySocket = new Map(); // socketId -> { tokens, lastRefill }

// 서버가 직접 발급한 형식(/uploads/<uuid>.<ext>)만 통과시킨다.
const UPLOAD_URL_RE = /^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/;

const MSG_RATE_CAPACITY = 3; // 초당 3건
const MSG_RATE_REFILL_PER_MS = MSG_RATE_CAPACITY / 1000;

function takeMessageToken(socketId) {
  const now = nowMs();
  let bucket = messageBucketsBySocket.get(socketId);
  if (!bucket) {
    bucket = { tokens: MSG_RATE_CAPACITY, lastRefill: now };
    messageBucketsBySocket.set(socketId, bucket);
  }
  const elapsed = now - bucket.lastRefill;
  bucket.tokens = Math.min(MSG_RATE_CAPACITY, bucket.tokens + elapsed * MSG_RATE_REFILL_PER_MS);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

function broadcastSystemMessage(text) {
  const createdAt = nowMs();
  insertMessage({ type: 'system', sender: null, content: text, imageUrl: null, createdAt });
  trimOldMessages(MAX_HISTORY);
  io.emit('chat:message', { type: 'system', sender: null, content: text, imageUrl: null, createdAt });
}

function uniqueName(baseName) {
  const existingNames = new Set(Array.from(connectedSockets.values()).map((u) => u.name));
  if (!existingNames.has(baseName)) return baseName;
  let n = 2;
  while (existingNames.has(`${baseName}-${n}`)) n += 1;
  return `${baseName}-${n}`;
}

function getAdminSnapshot() {
  const connectedUsers = Array.from(connectedSockets.values()).map((u) => ({
    socketId: u.socketId,
    name: u.name,
    ip: u.ip,
    connectedAt: u.connectedAt,
    lastActivity: u.lastActivity,
    userAgent: u.userAgent,
    isAdmin: u.isAdmin,
  }));

  return {
    connectedUsers,
    connectedCount: connectedUsers.length,
    totalMessages: getTotalMessageCount(),
    loginAttempts: getRecentLoginAttempts(50),
  };
}

function broadcastAdminSnapshot() {
  io.to('admins').emit('admin:update', getAdminSnapshot());
}

// 쿠키 기반 인증 (핸드셰이크 헤더에서 직접 파싱)
io.use((socket, next) => {
  const cookieHeader = socket.handshake.headers.cookie || '';
  const match = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));

  if (!match) return next(new Error('unauthorized'));

  const rawValue = match.slice(COOKIE_NAME.length + 1);
  const token = decodeURIComponent(rawValue);
  const session = verifyToken(token);
  if (!session) return next(new Error('unauthorized'));

  if (!session.isAdmin && isKicked(session.name)) {
    return next(new Error('kicked'));
  }

  socket.data.baseName = session.name;
  socket.data.isAdmin = session.isAdmin;
  next();
});

io.on('connection', (socket) => {
  const isAdminMonitor = !!socket.data.isAdmin && socket.handshake.query.mode === 'admin';

  // ---- 관리자 대시보드 전용 연결: 채팅 참가자 목록에는 포함되지 않음 ----
  if (isAdminMonitor) {
    socket.join('admins');
    socket.emit('admin:update', getAdminSnapshot());

    socket.on('admin:kick', ({ socketId } = {}) => {
      const target = io.sockets.sockets.get(socketId);
      if (!target) return;
      const info = connectedSockets.get(socketId);
      const name = info ? info.name : '알 수 없음';

      // 표시 이름이 아니라 세션에 들어있는 원래 이름으로 차단해야 재접속을 막을 수 있다.
      const sessionName = target.data && target.data.baseName;
      if (sessionName) kickedUntil.set(sessionName, nowMs() + KICK_BLOCK_MS);

      target.emit('system:kicked');
      target.disconnect(true);

      broadcastSystemMessage(`${name}님이 관리자에 의해 강제 퇴장되었습니다.`);
      broadcastAdminSnapshot();
    });

    socket.on('admin:clearHistory', () => {
      clearAllMessages();
      io.emit('chat:cleared');
      broadcastSystemMessage('관리자가 채팅 기록을 모두 삭제했습니다.');
      broadcastAdminSnapshot();
    });

    return;
  }

  // ---- 일반 채팅 참가자 ----
  const ip = getSocketIp(socket);
  const userAgent = summarizeUserAgent(socket.handshake.headers['user-agent']);
  const name = uniqueName(socket.data.baseName);
  const now = nowMs();

  connectedSockets.set(socket.id, {
    socketId: socket.id,
    name,
    ip,
    connectedAt: now,
    lastActivity: now,
    userAgent,
    isAdmin: !!socket.data.isAdmin,
  });
  socket.data.name = name;
  broadcastAdminSnapshot();

  socket.emit('welcome', {
    name,
    isAdmin: !!socket.data.isAdmin,
    history: getRecentMessages(MAX_HISTORY),
  });

  broadcastSystemMessage(`${name}님이 입장했습니다.`);

  socket.on('chat:message', (payload) => {
    const info = connectedSockets.get(socket.id);
    if (info) info.lastActivity = nowMs();

    if (!takeMessageToken(socket.id)) {
      socket.emit('chat:error', { error: 'rate_limited' });
      return;
    }

    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    if (!text || text.length > 2000) {
      socket.emit('chat:error', { error: 'invalid_message' });
      return;
    }

    const createdAt = nowMs();
    insertMessage({ type: 'text', sender: name, content: text, imageUrl: null, createdAt });
    trimOldMessages(MAX_HISTORY);

    io.emit('chat:message', { type: 'text', sender: name, content: text, imageUrl: null, createdAt });
  });

  socket.on('chat:image', (payload) => {
    const info = connectedSockets.get(socket.id);
    if (info) info.lastActivity = nowMs();

    if (!takeMessageToken(socket.id)) {
      socket.emit('chat:error', { error: 'rate_limited' });
      return;
    }

    const url = typeof payload?.url === 'string' ? payload.url : '';
    if (!UPLOAD_URL_RE.test(url)) {
      socket.emit('chat:error', { error: 'invalid_image' });
      return;
    }

    const createdAt = nowMs();
    insertMessage({ type: 'image', sender: name, content: null, imageUrl: url, createdAt });
    trimOldMessages(MAX_HISTORY);

    io.emit('chat:message', { type: 'image', sender: name, content: null, imageUrl: url, createdAt });
  });

  socket.on('disconnect', () => {
    connectedSockets.delete(socket.id);
    messageBucketsBySocket.delete(socket.id);
    broadcastSystemMessage(`${name}님이 퇴장했습니다.`);
    broadcastAdminSnapshot();
  });
});

server.listen(PORT, () => {
  console.log(`Comrade Chat 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
