@echo off
cd /d "D:\Outer System\Ingress\Ingress2026Florida"

echo ---- Adding Files ----
git add .

echo.
echo ---- Commit ----
git commit -m "Update weekly report"

echo.
echo ---- Pull latest from GitHub ----
git pull --rebase origin main

echo.
echo ---- Push ----
git push origin main

echo.
echo Done.
pause
