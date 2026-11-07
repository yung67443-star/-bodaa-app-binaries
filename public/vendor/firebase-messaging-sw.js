/* dolce ride vendor web — background push (orders + chat). Never touches APK fcmToken. */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
importScripts('./firebase-config.js');
try { firebase.initializeApp(self.DOLCE_FIREBASE_CONFIG || {}); } catch (e) {}
try {
  var messaging = firebase.messaging();
  messaging.onBackgroundMessage(function(payload){
    var n = payload.notification || {};
    var data = payload.data || {};
    var title = n.title || data.title || '🧾 New order — dolce ride';
    var body = n.body || data.body || 'Open Live Orders to accept it. Chat replies are in 💬 Chats.';
    self.registration.showNotification(title, { body: body, icon: './icon.png', data: data });
  });
  self.addEventListener('notificationclick', function(event){
    event.notification.close();
    event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list){
      if (list.length && list[0].focus) return list[0].focus();
      return clients.openWindow('./');
    }));
  });
} catch (e) {}