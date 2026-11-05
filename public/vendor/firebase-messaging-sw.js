importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
importScripts('./firebase-config.js');
firebase.initializeApp(self.DOLCE_FIREBASE_CONFIG || {});
try {
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const t = (payload.notification || {}).title || '🧾 New order — dolce ride';
    const b = (payload.notification || {}).body || 'Open Live Orders to accept it.';
    self.registration.showNotification(t, { body: b, icon: './icon.png' });
  });
} catch (e) {}