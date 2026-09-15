(() => {
  'use strict';

  const btnTheme = document.getElementById('btn-theme');
  const statConnected = document.getElementById('stat-connected');
  const statTotalMessages = document.getElementById('stat-total-messages');
  const btnClearHistory = document.getElementById('btn-clear-history');
  const tableUsers = document.getElementById('table-users');
  const tableLoginAttempts = document.getElementById('table-login-attempts');

  // ---------------------------------------------------------------------
  // 테마 (index.html과 동일한 저장소 공유)
  // ---------------------------------------------------------------------
  function currentIsDark() {
    const explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'dark') return true;
    if (explicit === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyTheme(theme) {
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  btnTheme.addEventListener('click', () => {
    const next = currentIsDark() ? 'light' : 'dark';
    localStorage.setItem('comrade-theme', next);
    applyTheme(next);
  });

  applyTheme(localStorage.getItem('comrade-theme'));

  // ---------------------------------------------------------------------
  // 소켓 연결 (mode=admin 쿼리로 "모니터링 전용" 연결임을 서버에 알림)
  // ---------------------------------------------------------------------
  const socket = io({ query: { mode: 'admin' }, withCredentials: true });

  socket.on('connect_error', () => {
    document.body.innerHTML =
      '<p style="padding:24px;font-family:sans-serif;">관리자 권한이 없거나 세션이 만료되었습니다.</p>';
  });

  socket.on('admin:update', (data) => {
    render(data);
  });

  function formatDateTime(ts) {
    const d = new Date(ts);
    return d.toLocaleString('ko-KR', { hour12: false });
  }

  function render(data) {
    statConnected.textContent = String(data.connectedCount);
    statTotalMessages.textContent = String(data.totalMessages);
    renderUsers(data.connectedUsers);
    renderLoginAttempts(data.loginAttempts);
  }

  function renderUsers(users) {
    tableUsers.innerHTML = '';

    if (!users.length) {
      const tr = document.createElement('tr');
      tr.className = 'empty-row';
      const td = document.createElement('td');
      td.colSpan = 6;
      td.textContent = '현재 접속자가 없습니다.';
      tr.appendChild(td);
      tableUsers.appendChild(tr);
      return;
    }

    users.forEach((u) => {
      const tr = document.createElement('tr');

      const nameTd = document.createElement('td');
      nameTd.textContent = u.name + (u.isAdmin ? ' (관리자)' : '');
      tr.appendChild(nameTd);

      const ipTd = document.createElement('td');
      ipTd.textContent = u.ip;
      tr.appendChild(ipTd);

      const connectedTd = document.createElement('td');
      connectedTd.textContent = formatDateTime(u.connectedAt);
      tr.appendChild(connectedTd);

      const activityTd = document.createElement('td');
      activityTd.textContent = formatDateTime(u.lastActivity);
      tr.appendChild(activityTd);

      const uaTd = document.createElement('td');
      uaTd.textContent = u.userAgent;
      tr.appendChild(uaTd);

      const actionTd = document.createElement('td');
      const kickBtn = document.createElement('button');
      kickBtn.className = 'kick-btn';
      kickBtn.textContent = '강제 퇴장';
      kickBtn.addEventListener('click', () => {
        if (!confirm(`${u.name}님을 강제 퇴장시키겠습니까?`)) return;
        socket.emit('admin:kick', { socketId: u.socketId });
      });
      actionTd.appendChild(kickBtn);
      tr.appendChild(actionTd);

      tableUsers.appendChild(tr);
    });
  }

  function renderLoginAttempts(attempts) {
    tableLoginAttempts.innerHTML = '';

    if (!attempts.length) {
      const tr = document.createElement('tr');
      tr.className = 'empty-row';
      const td = document.createElement('td');
      td.colSpan = 4;
      td.textContent = '로그인 시도 기록이 없습니다.';
      tr.appendChild(td);
      tableLoginAttempts.appendChild(tr);
      return;
    }

    attempts.forEach((a) => {
      const tr = document.createElement('tr');

      const timeTd = document.createElement('td');
      timeTd.textContent = formatDateTime(a.created_at);
      tr.appendChild(timeTd);

      const nameTd = document.createElement('td');
      nameTd.textContent = a.name || '(없음)';
      tr.appendChild(nameTd);

      const ipTd = document.createElement('td');
      ipTd.textContent = a.ip;
      tr.appendChild(ipTd);

      const resultTd = document.createElement('td');
      resultTd.textContent = a.success ? '성공' : '실패';
      resultTd.className = a.success ? 'badge-success' : 'badge-fail';
      tr.appendChild(resultTd);

      tableLoginAttempts.appendChild(tr);
    });
  }

  btnClearHistory.addEventListener('click', () => {
    if (!confirm('정말로 전체 채팅 기록을 삭제하시겠습니까? 되돌릴 수 없습니다.')) return;
    socket.emit('admin:clearHistory');
  });
})();
