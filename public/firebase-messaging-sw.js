importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey:            "AIzaSyALAzM3VqOhg7_TiW3Oa0sNlgdzzKyRZ58",
  authDomain:        "hogar-score.firebaseapp.com",
  projectId:         "hogar-score",
  storageBucket:     "hogar-score.firebasestorage.app",
  messagingSenderId: "440724610929",
  appId:             "1:440724610929:web:22ca99dfd9c3f53352a0d0",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const { title = "🏠 Hogar Score", body = "Nueva actividad" } = payload.notification ?? {};
  self.registration.showNotification(title, {
    body,
    icon: "/icon.svg",
    badge: "/icon.svg",
    vibrate: [200, 100, 200],
    tag: "hogar-score",
  });
});
