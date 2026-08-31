// firebase-config.js — Bitácora de Viaje
// Colecciones Firestore:
//   viaje_dias/          → entradas del diario
//   viaje_comentarios/   → comentarios de lectores (requieren aprobación)

// ⚠️ Reemplazá los valores con los de tu proyecto Firebase
// Firebase Console → Configuración del proyecto → Tus apps → SDK config
const firebaseConfig = {
  apiKey: "AIzaSyAXyFzz3O1tKejiPEMUdbnOmlMvZ3ngyG4",
  authDomain: "travelapp-ab699.firebaseapp.com",
  databaseURL: "https://travelapp-ab699-default-rtdb.firebaseio.com",
  projectId: "travelapp-ab699",
  storageBucket: "travelapp-ab699.firebasestorage.app",
  messagingSenderId: "551873480418",
  appId: "1:551873480418:web:cc79bc498531ba8b5c80bb"
};

// ⚠️ CLOUDINARY: Reemplazá con tus datos
// 1. Creá cuenta en https://cloudinary.com (gratis)
// 2. Settings → Upload → Add upload preset → Modo: Unsigned
// 3. Copiá Cloud Name y Upload Preset name acá
const CLOUDINARY_CLOUD_NAME = "ojggazdy";
const CLOUDINARY_UPLOAD_PRESET = "travel";
