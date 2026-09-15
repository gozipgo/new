// auth.js
// 별도 세션 스토어 없이, "payload.signature" 형태의 서명된 토큰을 쿠키에 직접 저장하는 방식.
// (재시작해도 로그인 상태가 유지되고, 별도 세션 테이블이 필요 없어 구조가 단순해짐)

const crypto = require('crypto');

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  throw new Error('SESSION_SECRET 환경변수가 설정되어 있지 않습니다. .env 파일을 확인하세요.');
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = 'comrade_session';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payloadStr) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payloadStr).digest('base64url');
}

function createToken({ name, isAdmin }) {
  const payload = {
    name,
    isAdmin: !!isAdmin,
    exp: Date.now() + SEVEN_DAYS_MS,
  };
  const payloadStr = base64url(JSON.stringify(payload));
  const signature = sign(payloadStr);
  return `${payloadStr}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;

  const idx = token.indexOf('.');
  const payloadStr = token.slice(0, idx);
  const signature = token.slice(idx + 1);
  if (!payloadStr || !signature) return null;

  const expectedSig = sign(payloadStr);

  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadStr, 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }

  if (!payload || typeof payload.exp !== 'number' || Date.now() > payload.exp) {
    return null;
  }
  if (!payload.name || typeof payload.name !== 'string') return null;

  return { name: payload.name, isAdmin: !!payload.isAdmin };
}

// 길이가 다른 문자열도 타이밍 공격에 안전하게 비교
function timingSafeEqualStr(a, b) {
  const aBuf = Buffer.from(String(a ?? ''));
  const bBuf = Buffer.from(String(b ?? ''));
  if (aBuf.length !== bBuf.length) {
    // 길이가 다르면 즉시 반환하지 않고, 동일 길이 더미 비교를 한 번 수행해 타이밍 차이를 줄임
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function cookieOptions(isProd) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!isProd,
    maxAge: SEVEN_DAYS_MS,
    path: '/',
  };
}

module.exports = {
  COOKIE_NAME,
  createToken,
  verifyToken,
  timingSafeEqualStr,
  cookieOptions,
};
