@echo off
setlocal

cd /d "D:\Outer System\Ingress\IngressWeekly"

python repair_report_chain.py

echo.
echo Done.
pause
endlocal
