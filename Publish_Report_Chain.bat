@echo off
setlocal

cd /d "D:\Outer System\Ingress\IngressWeekly"

echo ---- Repairing Report Chain ----
python repair_report_chain.py
if errorlevel 1 goto :fail

echo.
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
echo ---- Adding Repair Scripts ----
git add -- "repair_report_chain.py" "Repair_Report_Chain.bat"
if errorlevel 1 goto :fail

echo.
echo ---- Commit ----
git commit -m "Update weekly report archive chain"
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
