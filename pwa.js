// 웹앱(PWA) 설치 지원: 서비스 워커 등록 + 메뉴의 "앱 설치" 버튼
(() => {
  'use strict';

  // 서비스 워커는 http(s)에서만 동작합니다 (파일 더블클릭 실행 시에는 건너뜀).
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW 등록 실패:', err));
    });
  }

  let deferred = null;
  const showButtons = on => document.querySelectorAll('.install-btn').forEach(b => b.classList.toggle('hidden', !on));

  window.PWA = {
    available: false,
    async install() {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      window.PWA.available = false;
      showButtons(false);
    },
  };

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    window.PWA.available = true;
    showButtons(true);
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    window.PWA.available = false;
    showButtons(false);
  });
})();
