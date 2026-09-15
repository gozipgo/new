(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // 엘리먼트 참조
  // ---------------------------------------------------------------------
  const loginScreen = document.getElementById('login-screen');
  const chatScreen = document.getElementById('chat-screen');

  const loginForm = document.getElementById('login-form');
  const inputName = document.getElementById('input-name');
  const inputPassword = document.getElementById('input-password');
  const inputAdminPassword = document.getElementById('input-admin-password');
  const checkboxAdmin = document.getElementById('checkbox-admin');
  const fieldPassword = document.getElementById('field-password');
  const fieldAdminPassword = document.getElementById('field-admin-password');
  const loginError = document.getElementById('login-error');

  const messagesEl = document.getElementById('messages');
  const messageForm = document.getElementById('message-form');
  const inputText = document.getElementById('input-text');
  const btnPickImage = document.getElementById('btn-pick-image');
  const fileInput = document.getElementById('file-input');
  const btnTheme = document.getElementById('btn-theme');
  const btnLogout = document.getElementById('btn-logout');
  const linkAdmin = document.getElementById('link-admin');

  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');

  let socket = null;
  let myName = '';

  // ---------------------------------------------------------------------
  // 테마 (다크 / 라이트, localStorage에 저장)
  // ---------------------------------------------------------------------
  function applyTheme(theme) {
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  function currentIsDark() {
    const explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'dark') return true;
    if (explicit === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function initTheme() {
    const saved = localStorage.getItem('comrade-theme');
    applyTheme(saved || null);
  }

  btnTheme.addEventListener('click', () => {
    const next = currentIsDark() ? 'light' : 'dark';
    localStorage.setItem('comrade-theme', next);
    applyTheme(next);
  });

  initTheme();

  // ---------------------------------------------------------------------
  // 로그인 화면 <-> 채팅 화면 전환
  // ---------------------------------------------------------------------
  function showLogin() {
    loginScreen.classList.remove('hidden');
    chatScreen.classList.add('hidden');
  }

  function showChat() {
    loginScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
  }

  checkboxAdmin.addEventListener('change', () => {
    if (checkboxAdmin.checked) {
      fieldPassword.classList.add('hidden');
      fieldAdminPassword.classList.remove('hidden');
      inputPassword.required = false;
      inputAdminPassword.required = true;
    } else {
      fieldPassword.classList.remove('hidden');
      fieldAdminPassword.classList.add('hidden');
      inputPassword.required = true;
      inputAdminPassword.required = false;
    }
  });

  function setLoginError(msg) {
    if (!msg) {
      loginError.classList.add('hidden');
      loginError.textContent = '';
    } else {
      loginError.classList.remove('hidden');
      loginError.textContent = msg;
    }
  }

  const LOGIN_ERROR_MESSAGES = {
    too_many_attempts: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.',
    invalid_name: '표시 이름을 다시 확인해주세요.',
    invalid_credentials: '비밀번호가 올바르지 않습니다.',
  };

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setLoginError('');

    const isAdmin = checkboxAdmin.checked;
    const body = {
      displayName: inputName.value,
      isAdmin,
      password: isAdmin ? inputAdminPassword.value : inputPassword.value,
    };

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setLoginError(LOGIN_ERROR_MESSAGES[data.error] || '입장에 실패했습니다.');
        return;
      }

      enterChat(data.isAdmin);
    } catch (err) {
      setLoginError('서버에 연결할 수 없습니다.');
    }
  });

  btnLogout.addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } catch (err) {
      /* 무시 */
    }
    if (socket) socket.disconnect();
    location.reload();
  });

  // ---------------------------------------------------------------------
  // 채팅 진입 + 소켓 연결
  // ---------------------------------------------------------------------
  function enterChat(isAdmin) {
    linkAdmin.classList.toggle('hidden', !isAdmin);
    showChat();
    connectSocket();
  }

  function connectSocket() {
    socket = io({ withCredentials: true });

    socket.on('welcome', ({ name, history }) => {
      myName = name;
      messagesEl.innerHTML = '';
      history.forEach(renderStoredMessage);
      scrollToBottom();
    });

    socket.on('chat:message', (msg) => {
      renderLiveMessage(msg);
      scrollToBottom();
    });

    socket.on('chat:cleared', () => {
      messagesEl.innerHTML = '';
    });

    socket.on('chat:error', ({ error }) => {
      if (error === 'rate_limited') {
        flashSystemNotice('메시지를 너무 빠르게 보내고 있어요. 잠시 후 다시 시도해주세요.');
      } else {
        flashSystemNotice('메시지를 보내지 못했습니다.');
      }
    });

    socket.on('system:kicked', async () => {
      try {
        await fetch('/api/logout', { method: 'POST', credentials: 'include' });
      } catch (err) {
        /* 무시 */
      }
      alert('관리자에 의해 강제 퇴장되었습니다.');
      location.href = '/';
    });

    socket.on('connect_error', (err) => {
      // 인증 문제일 때만 로그인 화면으로 되돌린다.
      // (지하철/엘리베이터 등에서 생기는 일시적 끊김은 Socket.IO가 알아서 재연결한다)
      const reason = err && err.message;
      if (reason === 'unauthorized' || reason === 'kicked') {
        socket.disconnect();
        showLogin();
        setLoginError(
          reason === 'kicked'
            ? '강제 퇴장된 계정입니다. 잠시 후 다시 시도해주세요.'
            : '세션이 만료되었습니다. 다시 입장해주세요.'
        );
      }
    });
  }

  function flashSystemNotice(text) {
    const el = document.createElement('div');
    el.className = 'msg-system';
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  // ---------------------------------------------------------------------
  // 메시지 렌더링 (항상 textContent만 사용 — innerHTML에 사용자 입력 직접 대입 금지)
  // ---------------------------------------------------------------------
  function formatTime(ts) {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function renderStoredMessage(msg) {
    appendMessageEl(buildMessageEl(msg));
  }

  function renderLiveMessage(msg) {
    appendMessageEl(buildMessageEl(msg));
  }

  function appendMessageEl(el) {
    messagesEl.appendChild(el);
  }

  function buildMessageEl(msg) {
    if (msg.type === 'system') {
      const el = document.createElement('div');
      el.className = 'msg-system';
      el.textContent = msg.content || '';
      return el;
    }

    const isMine = msg.sender === myName;
    const row = document.createElement('div');
    row.className = `msg-row ${isMine ? 'mine' : 'theirs'}`;

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = `${msg.sender} · ${formatTime(msg.created_at || msg.createdAt)}`;
    row.appendChild(meta);

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    if (msg.type === 'image') {
      bubble.classList.add('image-bubble');
      const img = document.createElement('img');
      img.className = 'chat-image';
      img.src = msg.image_url || msg.imageUrl;
      img.alt = '전송된 이미지';
      img.addEventListener('click', () => openLightbox(img.src));
      bubble.appendChild(img);
    } else {
      bubble.textContent = msg.content || '';
    }

    row.appendChild(bubble);
    return row;
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ---------------------------------------------------------------------
  // 라이트박스
  // ---------------------------------------------------------------------
  function openLightbox(src) {
    lightboxImg.src = src;
    lightbox.classList.remove('hidden');
  }

  lightbox.addEventListener('click', () => {
    lightbox.classList.add('hidden');
    lightboxImg.src = '';
  });

  // ---------------------------------------------------------------------
  // 텍스트 메시지 전송
  // ---------------------------------------------------------------------
  messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendTextMessage();
  });

  inputText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendTextMessage();
    }
  });

  inputText.addEventListener('input', () => {
    inputText.style.height = 'auto';
    inputText.style.height = `${Math.min(inputText.scrollHeight, 120)}px`;
  });

  function sendTextMessage() {
    const text = inputText.value.trim();
    if (!text || !socket) return;
    if (text.length > 2000) {
      flashSystemNotice('메시지는 2000자를 넘을 수 없습니다.');
      return;
    }
    socket.emit('chat:message', { text });
    inputText.value = '';
    inputText.style.height = 'auto';
  }

  // ---------------------------------------------------------------------
  // 이미지: 리사이즈 후 업로드 -> 성공 시 소켓으로 URL 전송
  // ---------------------------------------------------------------------
  const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  const MAX_SIDE = 1280;
  const JPEG_QUALITY = 0.8;
  const MAX_BYTES = 2 * 1024 * 1024;

  function resizeImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read_failed'));
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = () => reject(new Error('decode_failed'));
        img.onload = () => {
          let { width, height } = img;
          if (width > MAX_SIDE || height > MAX_SIDE) {
            if (width >= height) {
              height = Math.round((height * MAX_SIDE) / width);
              width = MAX_SIDE;
            } else {
              width = Math.round((width * MAX_SIDE) / height);
              height = MAX_SIDE;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              if (!blob) return reject(new Error('resize_failed'));
              resolve(blob);
            },
            'image/jpeg',
            JPEG_QUALITY
          );
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleImageFile(file) {
    if (!file) return;
    if (!ALLOWED_MIME.has(file.type)) {
      flashSystemNotice('지원하지 않는 이미지 형식입니다. (png, jpeg, webp, gif만 가능)');
      return;
    }

    let blob;
    try {
      blob = await resizeImageFile(file);
    } catch (err) {
      flashSystemNotice('이미지를 처리하지 못했습니다.');
      return;
    }

    if (blob.size > MAX_BYTES) {
      flashSystemNotice('이미지 용량이 너무 큽니다 (최대 2MB).');
      return;
    }

    const formData = new FormData();
    formData.append('image', blob, 'upload.jpg');

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        flashSystemNotice('이미지 업로드에 실패했습니다.');
        return;
      }
      if (socket) socket.emit('chat:image', { url: data.url });
    } catch (err) {
      flashSystemNotice('이미지 업로드 중 오류가 발생했습니다.');
    }
  }

  btnPickImage.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    handleImageFile(file);
  });

  // 붙여넣기(Ctrl+V)
  document.addEventListener('paste', (e) => {
    if (chatScreen.classList.contains('hidden')) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          handleImageFile(file);
        }
        break;
      }
    }
  });

  // 드래그 앤 드롭
  ['dragenter', 'dragover'].forEach((evt) => {
    messageForm.addEventListener(evt, (e) => {
      e.preventDefault();
      messageForm.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((evt) => {
    messageForm.addEventListener(evt, (e) => {
      e.preventDefault();
      messageForm.classList.remove('dragover');
    });
  });

  messageForm.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleImageFile(file);
  });

  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    if (e.target === messageForm || messageForm.contains(e.target)) return;
    e.preventDefault();
  });

  // ---------------------------------------------------------------------
  // iOS 키보드 대응: visualViewport 기준으로 실제 보이는 높이를 CSS 변수로 반영
  // ---------------------------------------------------------------------
  function syncViewportHeight() {
    const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${h}px`);
    document.body.style.height = `${h}px`;
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncViewportHeight);
    window.visualViewport.addEventListener('scroll', syncViewportHeight);
  }
  window.addEventListener('resize', syncViewportHeight);
  syncViewportHeight();

  // ---------------------------------------------------------------------
  // 새로고침 시 이미 로그인되어 있으면 바로 채팅 화면으로
  // ---------------------------------------------------------------------
  (async function bootstrap() {
    try {
      const res = await fetch('/api/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.ok) {
          enterChat(data.isAdmin);
          return;
        }
      }
    } catch (err) {
      /* 무시 */
    }
    showLogin();
  })();
})();
