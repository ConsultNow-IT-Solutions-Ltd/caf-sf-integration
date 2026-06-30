@echo off
REM Run a whole suite in a visible browser, then build and open the run report.
REM
REM     .\watch.cmd
REM     .\watch.cmd -Suite sn
REM     .\watch.cmd -Pace 1500 -SlowMo 600
REM
REM watch.ps1 does the work; this launches it with -ExecutionPolicy Bypass so a
REM shell with the default Restricted policy can still run it. The bypass is
REM scoped to that one PowerShell process and changes nothing on the machine.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0watch.ps1" %*
