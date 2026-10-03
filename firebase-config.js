// ONE-TIME SETUP:
// Paste the Firebase Web App config from Firebase Console here.
// Do NOT change EDITOR_EMAIL unless you also change it in database.rules.json
window.FIREBASE_CONFIG = {
  apiKey: "PASTE_API_KEY_HERE",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://PASTE_DATABASE_NAME-default-rtdb.firebaseio.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "PASTE_MESSAGING_SENDER_ID",
  appId: "PASTE_APP_ID"
};

// This account is created ONCE in Firebase Authentication.
// Players never type the email — only the shared editor password.
window.BOARD_EDITOR_EMAIL = "editor@board.example";

window.BOARD_PLAYER_EMAIL = "player@board.example";
