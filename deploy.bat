@echo off
echo.
echo  Hogar Score - Deploy automatico
echo  ================================
echo.

cd /d "%~dp0"

echo [1/4] Instalando dependencias...
call npm install
if %errorlevel% neq 0 ( echo ERROR en npm install & pause & exit /b )

echo [2/4] Compilando el proyecto...
call npm run build
if %errorlevel% neq 0 ( echo ERROR en build & pause & exit /b )

echo [3/4] Preparando git...
git add .
git commit -m "v2: Firebase realtime + PWA + estadisticas + notificaciones"

echo [4/4] Subiendo a GitHub...
git push origin main
if %errorlevel% neq 0 (
  echo.
  echo  Intentando con master...
  git push origin master
)

echo.
echo  LISTO! En 1-2 minutos Vercel redespliega automaticamente.
echo  Tu app va a estar en https://hogar-score.vercel.app
echo.
pause
