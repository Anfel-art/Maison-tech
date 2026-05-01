@echo off
set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
set ANDROID_HOME=C:\Users\8bits\AppData\Local\Android\Sdk
set PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%
cd /d "%~dp0android"
call gradlew.bat assembleDebug
echo BUILD EXIT CODE: %ERRORLEVEL%
