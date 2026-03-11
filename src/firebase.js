import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

const firebaseConfig = {
  apiKey:            "AIzaSyALAzM3VqOhg7_TiW3Oa0sNlgdzzKyRZ58",
  authDomain:        "hogar-score.firebaseapp.com",
  projectId:         "hogar-score",
  storageBucket:     "hogar-score.firebasestorage.app",
  messagingSenderId: "440724610929",
  appId:             "1:440724610929:web:22ca99dfd9c3f53352a0d0",
};

export const VAPID_KEY = "BBJZDVxO5-nuBTCnZJQ-dIqAaolGJGOGwKrk-1IwmoqAxjBAwwxOPz2KmcCBlwMlqBQeVHP_NEu_ERKpkta2xwo";

export const app       = initializeApp(firebaseConfig);
export const db        = getFirestore(app);
export const messaging = (() => {
  try { return getMessaging(app); } catch (_) { return null; }
})();

export { getToken, onMessage };
