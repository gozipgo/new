// db.js
// better-sqlite3 기반 단일 파일 DB. messages(채팅 기록), login_attempts(로그인 시도 로그) 두 테이블만 사용.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'chat.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,          -- 'text' | 'image' | 'system'
    sender TEXT,                 -- system 메시지는 NULL
    content TEXT,                -- text/system 메시지 본문
    image_url TEXT,              -- image 메시지의 /uploads/... 경로
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    ip TEXT,
    success INTEGER NOT NULL,    -- 0 | 1
    created_at INTEGER NOT NULL
  );
`);

const MAX_HISTORY = 200;

const insertMessageStmt = db.prepare(
  `INSERT INTO messages (type, sender, content, image_url, created_at) VALUES (?, ?, ?, ?, ?)`
);

function insertMessage({ type, sender, content, imageUrl, createdAt }) {
  const info = insertMessageStmt.run(
    type,
    sender || null,
    content || null,
    imageUrl || null,
    createdAt
  );
  return info.lastInsertRowid;
}

function getRecentMessages(limit = MAX_HISTORY) {
  const rows = db.prepare(`SELECT * FROM messages ORDER BY id DESC LIMIT ?`).all(limit);
  return rows.reverse();
}

// 저장 공간이 무한히 늘어나지 않도록 최근 N건만 유지
function trimOldMessages(keep = MAX_HISTORY) {
  db.prepare(
    `DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY id DESC LIMIT ?)`
  ).run(keep);
}

function clearAllMessages() {
  db.prepare(`DELETE FROM messages`).run();
}

function getTotalMessageCount() {
  const row = db.prepare(`SELECT COUNT(*) AS cnt FROM messages`).get();
  return row.cnt;
}

const insertLoginAttemptStmt = db.prepare(
  `INSERT INTO login_attempts (name, ip, success, created_at) VALUES (?, ?, ?, ?)`
);

function insertLoginAttempt({ name, ip, success, createdAt }) {
  insertLoginAttemptStmt.run(name || null, ip, success ? 1 : 0, createdAt);
}

function getRecentLoginAttempts(limit = 50) {
  return db.prepare(`SELECT * FROM login_attempts ORDER BY id DESC LIMIT ?`).all(limit);
}

module.exports = {
  db,
  insertMessage,
  getRecentMessages,
  trimOldMessages,
  clearAllMessages,
  getTotalMessageCount,
  insertLoginAttempt,
  getRecentLoginAttempts,
  MAX_HISTORY,
};
