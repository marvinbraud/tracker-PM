@echo off
REM ─── QUANT TERMINAL — Lanceur Windows ────────────────────────────────────────
cd /d "%~dp0"

echo.
echo   QUANT TERMINAL — Portfolio Manager
echo.

REM Verifier Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERREUR] Node.js introuvable.
    echo          Installez-le depuis https://nodejs.org/ ^(version 18+^)
    pause
    exit /b 1
)

REM Installer les dependances si necessaire
if not exist "node_modules\" (
    echo [INFO] Installation des dependances ^(premiere fois, ~1 min^)...
    call npm install --silent
    echo [OK] Dependances installees.
)

REM Build si dist/ absent
if not exist "dist\" (
    echo [INFO] Build de production...
    call npm run build
    echo [OK] Build termine.
)

echo [INFO] Demarrage sur http://localhost:5000
echo        Fermez cette fenetre pour arreter le serveur.
echo.

REM Ouvrir le navigateur apres 2 secondes
start "" /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:5000"

set NODE_ENV=production
node dist\index.cjs

pause
