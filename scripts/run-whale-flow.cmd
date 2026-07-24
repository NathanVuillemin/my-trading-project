@echo off
REM Wrapper for the daily Windows scheduled task. Runs the whale-flow collector
REM from the project root and appends stdout/stderr to a rolling log.
cd /d "%~dp0.."
"C:\Program Files\nodejs\node.exe" scripts\whale-flow.mjs >> "data\whale-flow\run.log" 2>&1
