// 웹앱(PWA) 설치 지원: 서비스 워커 등록 + "앱으로 설치" 버튼
(() => {
  'use strict';

  // 서비스 워커는 http(s)에서만 동작합니다 (파일 더블클릭 실행 시에는 건너뜀).
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW 등록 실패:', err));
    });
  }

  const installBtn = document.getElementById('install-btn');
  let deferred = null;

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    installBtn.classList.remove('hidden');
  });

  installBtn.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    installBtn.classList.add('hidden');
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    installBtn.classList.add('hidden');
  });
})();
