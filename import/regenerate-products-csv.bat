@echo off
chcp 65001 >nul
set "ROOT=%~dp0.."
cd /d "%ROOT%"

echo Корень проекта: %CD%
echo.

python -m pip install -r "%~dp0requirements.txt"
if errorlevel 1 (
  echo Ошибка pip. Попробуйте: py -m pip install -r "%~dp0requirements.txt"
  pause
  exit /b 1
)

python "%~dp0xlsx_to_products_csv.py"
if errorlevel 1 (
  echo Ошибка скрипта.
  pause
  exit /b 1
)

echo.
echo Готово. CSV: import\products-nocobase.csv
pause
