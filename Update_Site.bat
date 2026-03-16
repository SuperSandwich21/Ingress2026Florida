@echo off
cd /d "D:\Outer System\Ingress\IngressWeekly"

echo ---- Git Status ----
git status

echo.
echo ---- Adding Files ----
git add .

echo.
echo ---- Commit ----
git commit -m "Update weekly report"

echo.
echo ---- Push ----
git push

echo.
echo Done.
pause