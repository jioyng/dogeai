@echo off
rem Dodge game launcher: starts a local web server and opens the game in your browser.
rem Close this window to stop the server.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Open
