@echo off
setlocal
REM ASCII only: UTF-8/Cyrillic in .bat breaks cmd.exe on some Windows setups.

set "HERE=%~dp0"
cd /d "%HERE%.."

python -m pip install -r "%HERE%requirements.txt"
if errorlevel 1 (
  echo pip failed. Trying py launcher...
  py -m pip install -r "%HERE%requirements.txt"
  if errorlevel 1 (
    echo ERROR: pip. Run manually: python -m pip install -r import\requirements.txt
    pause
    exit /b 1
  )
)

python "%HERE%xlsx_to_products_csv.py"
if errorlevel 1 (
  py "%HERE%xlsx_to_products_csv.py"
  if errorlevel 1 (
    echo ERROR: script. Run: python import\xlsx_to_products_csv.py from repo root
    pause
    exit /b 1
  )
)

echo OK: import\products-nocobase.csv
pause
endlocal
