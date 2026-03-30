@echo off
setlocal

cd /d "D:\Outer System\Ingress\IngressWeekly"

echo ---- Git Status ----
git status
if errorlevel 1 goto :fail

echo.
echo ---- Adding Weekly Report HTML ----
git add -- "WeeklyReport.html"
if errorlevel 1 goto :fail

echo.
echo ---- Adding Archived Previous Reports ----
git add -- "Previous Reports"
if errorlevel 1 goto :fail

echo.
echo ---- Commit ----
git commit -m "Update weekly report and archived previous reports"
if errorlevel 1 (
    echo.
    echo No commit was created. There may be no staged changes.
    goto :done
)

echo.
echo ---- Push ----
git push
if errorlevel 1 goto :fail

echo.
echo Publish complete.
goto :done

:fail
echo.
echo Publish failed.

:done
pause
endlocal
