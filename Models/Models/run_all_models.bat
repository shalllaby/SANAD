@echo off
TITLE SANAD AI Models Runner
REM ========================================================
REM 🌙 SANAD — Start All AI Models
REM ========================================================

echo --------------------------------------------------------
echo [🔀] Starting all AI services...
echo --------------------------------------------------------

REM 1. Fall Detection (Port 8012)
echo [1/4] Starting Fall Detection Service...
start "Fall_Detection_8012" /D "Fall Detection0" cmd /c "python main.py && pause"

REM 2. Fire & Smoke Detection (Port 8013)
echo [2/4] Starting Fire & Smoke Detection Service...
start "Fire_Detection_8013" /D "Fire" cmd /c "python main.py && pause"

REM 3. Mood & Emotion Detection (Port 8014)
echo [3/4] Starting Mood Detection Service...
start "Mood_Detection_8014" /D "Mood Detectio0" cmd /c "python main.py && pause"

REM 4. General Health Risk (Port 8015)
echo [4/4] Starting Health Risk API...
start "Health_Risk_8015" /D "general_health" cmd /c "python main.py && pause"

echo.
echo --------------------------------------------------------
echo [✅] All models started successfully in separate windows.
echo --------------------------------------------------------
echo.
echo API URLs:
echo - Fall Detection:   http://localhost:8012
echo - Fire Detection:   http://localhost:8013
echo - Mood Detection:   http://localhost:8014
echo - Health Risk:      http://localhost:8015
echo.
echo 💡 If any window shows an error, please read it carefully.
echo    Most common error is missing libraries. You can fix it with:
echo    pip install fastapi uvicorn ultralytics opencv-python pandas joblib
echo --------------------------------------------------------
pause
