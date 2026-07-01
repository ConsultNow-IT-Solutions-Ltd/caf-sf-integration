@echo off
REM Run one test case in a visible browser and produce its Word evidence record.
REM
REM     .\test.cmd TC-INT-020
REM
REM This exists because "npm test" on Windows runs through npm.ps1, which a shell
REM with the default Restricted execution policy refuses to load. The error
REM ("running scripts is disabled on this system") names npm rather than the
REM policy, so it reads like a broken Node install. A .cmd shim has no such
REM problem, and neither does "npm.cmd test".
REM
REM Node is resolved by the shell's own PATH. If this reports that node is not
REM recognised, the shell predates the Node install - open a new one.
node "%~dp0run-case.mjs" %*
