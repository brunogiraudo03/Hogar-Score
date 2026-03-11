# 🏠 Hogar Score v2

App de tareas del hogar con puntos, tiempo real, estadísticas y notificaciones push.

---

## ⚡ Setup en 5 pasos

### 1. Crear proyecto Firebase
1. Ir a https://console.firebase.google.com
2. Click **Agregar proyecto** → nombre: `hogar-score` → crear
3. Deshabilitar Google Analytics (opcional)

### 2. Activar Firestore
1. En el menú lateral → **Firestore Database**
2. Click **Crear base de datos**
3. Elegir **Modo de prueba** (para empezar)
4. Región: **us-central1** (o la más cercana)

### 3. Obtener la configuración
1. Ir a **Configuración del proyecto** (ícono ⚙️) → **General**
2. Bajar hasta **Tus apps** → click **</>** (Web)
3. Registrar la app con el nombre `hogar-score-web`
4. Copiar el objeto `firebaseConfig`

### 4. Obtener la VAPID Key (para notificaciones)
1. **Configuración del proyecto** → **Cloud Messaging**
2. Bajar hasta **Configuración web** → **Certificados push web**
3. Click **Generar par de claves** → copiar la clave

### 5. Pegar los valores en el código
Editá estos dos archivos con tus valores:

**`src/firebase.js`** — pegá tu `firebaseConfig` y `VAPID_KEY`

**`public/firebase-messaging-sw.js`** — pegá el mismo `firebaseConfig`

---

## 🚀 Subir al repo y deployar

```bash
# En la carpeta del proyecto:
npm install
npm run build          # verificar que compila

git add .
git commit -m "feat: Firebase + PWA + notifications"
git push origin main
```

Vercel redespliega automáticamente. ¡Listo!

---

## 📱 Instalar como app (PWA)
- **Android (Chrome)**: Menú → "Agregar a pantalla de inicio"
- **iOS (Safari)**: Compartir → "Agregar a pantalla de inicio"
- **Desktop (Chrome/Edge)**: Ícono de instalación en la barra de direcciones

---

## 🔒 Reglas de seguridad Firestore
Cuando quieras asegurar la base de datos (después de probar),
copiá el contenido de `firestore.rules` en:
Firebase Console → Firestore → Reglas

---

## Estructura del proyecto
```
hogar-score/
├── public/
│   ├── manifest.json              # PWA manifest
│   ├── firebase-messaging-sw.js  # Service worker notificaciones
│   ├── icon.svg
│   ├── icon-192.png              # Generar en https://realfavicongenerator.net
│   └── icon-512.png
├── src/
│   ├── firebase.js               # ← PEGAR TU CONFIG ACÁ
│   ├── main.jsx
│   └── App.jsx
├── firestore.rules
├── index.html
├── package.json
└── vite.config.js
```
