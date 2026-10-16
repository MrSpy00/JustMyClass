@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul 2>&1
title JustMyClass - Derleme ve Yonetim

REM ==========================================================================
REM  Argumanla calistirildiginda menu gosterilmez; islem bitince script biter.
REM  Ornek:  build.bat build    build.bat test    build.bat status
REM ==========================================================================

set "CLI=0"
set "CMD=%~1"
if not "%CMD%"=="" set "CLI=1"

REM CLI modunda cikis icin ortak yol.
if "%CLI%"=="1" goto DISPATCH

:MENU
cls
echo ==============================================================================
echo                     JUSTMYCLASS - YEREL ONCELIKLI CALISMA ALANI
echo                       Gelistirici: aegisSoft (Mr. Spy)
echo              Depo: https://github.com/MrSpy00/JustMyClass
echo              Cikti dizini: release\  ^(bu tek resmi cikti klasorudur^)
echo ==============================================================================
echo.
echo  [1] Gelistirme modunu baslat
echo  [2] Temiz kurulum
echo  [3] Tip denetimi ve testler
echo  [4] Hizli klasor derlemesi     -^> release\win-unpacked\JustMyClass.exe
echo  [5] Tasinabilir tek dosya EXE  -^> release\JustMyClass-Portable-*.exe
echo  [6] Kurulum sihirbazi (Setup)   -^> release\JustMyClass-Setup-*.exe
echo  [7] Sifreleme ve depolama durumu
echo  [8] Derlenmis uygulamayi baslat
echo  [9] Cikis
echo.
echo ------------------------------------------------------------------------------
choice /c 123456789 /n /m "Secim [1-9]: "

REM choice basarisiz olursa (EOF / yonlendirilmis girdi) menuye donulmez.
if errorlevel 9 goto EXIT_SCRIPT
if errorlevel 8 goto RUN_APP
if errorlevel 7 goto STATUS
if errorlevel 6 goto BUILD_SETUP
if errorlevel 5 goto BUILD_PORTABLE
if errorlevel 4 goto BUILD_APP
if errorlevel 3 goto TESTS
if errorlevel 2 goto CLEAN
if errorlevel 1 goto DEV
echo [HATA] Gecersiz secim.
goto FINISH_MENU

:DISPATCH
if /i "%CMD%"=="1"        goto DEV
if /i "%CMD%"=="dev"      goto DEV
if /i "%CMD%"=="2"        goto CLEAN
if /i "%CMD%"=="clean"    goto CLEAN
if /i "%CMD%"=="3"        goto TESTS
if /i "%CMD%"=="test"     goto TESTS
if /i "%CMD%"=="check"    goto TESTS
if /i "%CMD%"=="4"        goto BUILD_APP
if /i "%CMD%"=="build"    goto BUILD_APP
if /i "%CMD%"=="5"        goto BUILD_PORTABLE
if /i "%CMD%"=="portable" goto BUILD_PORTABLE
if /i "%CMD%"=="6"        goto BUILD_SETUP
if /i "%CMD%"=="setup"    goto BUILD_SETUP
if /i "%CMD%"=="win"      goto BUILD_SETUP
if /i "%CMD%"=="installer" goto BUILD_SETUP
if /i "%CMD%"=="7"        goto STATUS
if /i "%CMD%"=="status"   goto STATUS
if /i "%CMD%"=="8"        goto RUN_APP
if /i "%CMD%"=="run"      goto RUN_APP
if /i "%CMD%"=="9"        goto EXIT_SCRIPT
if /i "%CMD%"=="exit"     goto EXIT_SCRIPT
if /i "%CMD%"=="help"     goto HELP
if /i "%CMD%"=="--help"   goto HELP

echo [HATA] Bilinmeyen arguman: %CMD%
echo Gecerli degerler: dev ^| clean ^| test ^| build ^| portable ^| setup ^| status ^| run ^| exit
exit /b 2

:HELP
cls
echo ==============================================================================
echo Kullanim
echo ==============================================================================
echo   build.bat                 Etkilesimli menu
echo   build.bat dev             Gelistirme sunucusu
echo   build.bat clean           Bagimliliklari ve cikti klasorlerini temizle
echo   build.bat test            Tip denetimi + birim testleri
echo   build.bat build           Hizli klasor derlemesi (win-unpacked)
echo   build.bat portable        Tasinabilir tek dosya EXE
echo   build.bat setup           Kurulum sihirbazi (Setup EXE)
echo   build.bat status          Sifreleme ve depolama durumu
echo   build.bat run             Derlenmis uygulamayi baslat
echo   build.bat exit            Cikis
exit /b 0

:DEV
cls
echo [1] Gelistirme sunucusu baslatiliyor...
echo.
call pnpm dev
set "RC=!ERRORLEVEL!"
echo.
echo [BILGI] Gelistirme sunucusu kapandi. (kod !RC!)
goto END_INTERACTIVE

:CLEAN
cls
echo [2] Temiz kurulum
echo.
echo Eski derleme ciktilari siliniyor...
if exist dist          rmdir /s /q dist
if exist dist-renderer rmdir /s /q dist-renderer
if exist dist-electron rmdir /s /q dist-electron
if exist release       rmdir /s /q release
echo.
echo Bagimliliklar kuruluyor...
call pnpm install
set "RC=!ERRORLEVEL!"
echo.
if not "!RC!"=="0" (
    echo [HATA] Kurulum basarisiz oldu. (kod !RC!)
) else (
    echo [BASARILI] Temiz kurulum tamamlandi.
)
goto END_INTERACTIVE

:TESTS
cls
echo [3] Tip denetimi ve birim testleri
echo.
echo 1/2 TypeScript denetimi...
call pnpm typecheck
if not "!ERRORLEVEL!"=="0" (
    echo.
    echo [HATA] TypeScript tip denetimi basarisiz. (kod !ERRORLEVEL!)
    goto END_INTERACTIVE
)
echo.
echo 2/2 Birim testleri...
call pnpm test
set "RC=!ERRORLEVEL!"
echo.
if not "!RC!"=="0" (
    echo [HATA] Birim testleri basarisiz. (kod !RC!)
) else (
    echo [BASARILI] Tip denetimi ve testler gecti.
)
goto END_INTERACTIVE

:BUILD_APP
cls
echo [4] Uretim derlemesi
echo.
echo 1/3 Eski ciktilar siliniyor...
if exist dist          rmdir /s /q dist
if exist dist-renderer rmdir /s /q dist-renderer
if exist dist-electron rmdir /s /q dist-electron
if exist release       rmdir /s /q release
echo.
echo 2/3 Tip denetimi ve paketleme...
call pnpm build
set "RC=!ERRORLEVEL!"
echo.
if not "!RC!"=="0" (
    echo [HATA] Derleme basarisiz oldu. (kod !RC!)
    goto END_INTERACTIVE
)
echo 3/3 Cikti dogrulaniyor...
echo.
echo ==============================================================================
if exist "release\win-unpacked\JustMyClass.exe" (
    echo [BASARILI] JustMyClass.exe olustu:
    echo            release\win-unpacked\JustMyClass.exe
) else (
    echo [UYARI] release\win-unpacked\JustMyClass.exe bulunamadi.
    echo         release klasorunu kontrol edin.
)
echo ==============================================================================
goto END_INTERACTIVE

:BUILD_PORTABLE
cls
echo [5] Tasinabilir EXE derleniyor...
echo.
call pnpm build:portable
set "RC=!ERRORLEVEL!"
echo.
if not "!RC!"=="0" (
    echo [HATA] Portable derlemesi basarisiz. (kod !RC!)
    goto END_INTERACTIVE
)
echo ==============================================================================
echo [BASARILI] Portable cikti uretildi. release\ klasorune bakiniz.
echo ==============================================================================
goto END_INTERACTIVE

:BUILD_SETUP
cls
echo [6] Kurulum sihirbazi (Setup Installer) ve paketler derleniyor...
echo.
call pnpm build:win
set "RC=!ERRORLEVEL!"
echo.
if not "!RC!"=="0" (
    echo [HATA] Kurulum paketi derlemesi basarisiz. (kod !RC!)
    goto END_INTERACTIVE
)
echo ==============================================================================
echo [BASARILI] Kurulum sihirbazi (Setup EXE) ve paketler olusturuldu:
echo            release\JustMyClass-Setup-*.exe
echo            release\JustMyClass-Portable-*.exe
echo ==============================================================================
goto END_INTERACTIVE

:STATUS
cls
echo ==============================================================================
echo  SIFRELEME VE DEPOLAMA DURUMU
echo ==============================================================================
echo.
set "DATA=%APPDATA%\justmyclass"
if not exist "%DATA%" set "DATA=%USERPROFILE%\.config\justmyclass"
echo Veri dizini: %DATA%
echo.
echo [1] Ana anahtar kasasi (API anahtarlari ve erisim belirteci):
if exist "%DATA%\master.key" (
    for %%A in ("%DATA%\master.key") do echo     Boyut: %%~zA bayt
    echo     Durum: VAR - isletim sistemi kasasi tarafindan sarmalanmis
) else (
    echo     Durum: YOK - henuz baslatilmadi veya kullanicidan bagimsiz
)
echo.
echo [2] Sifreli Classroom deposu (ders, odev, rubrik, teslim, taslak):
if exist "%DATA%\classroom.store.v2" (
    for %%B in ("%DATA%\classroom.store.v2") do echo     Boyut: %%~zB bayt
    echo     BiCim: AES-256-GCM
) else (
    echo     Durum: YOK - ilk senkronizasyon sonrasi olusur
)
echo.
echo [3] API anahtari kasasi:
if exist "%DATA%\secrets.env.vault" (
    echo     Durum: VAR
) else (
    echo     Durum: YOK - API anahtari girilmedi
)
echo.
echo [4] Yerel CAS dosya onbellegi:
if exist "%DATA%\cas" (
    echo     Durum: VAR
) else (
    echo     Durum: YOK - dosya indirilmedi
)
echo.
echo ==============================================================================
echo Not: "dist" klasoru artik resmi cikti degildir. Tum cikti "release" altindadir.
echo ==============================================================================
goto END_INTERACTIVE

:RUN_APP
cls
echo [7] JustMyClass baslatiliyor...
echo.
if exist "release\win-unpacked\JustMyClass.exe" (
    start "" "release\win-unpacked\JustMyClass.exe"
    echo Baslatildi: release\win-unpacked\JustMyClass.exe
) else (
    echo [UYARI] Derlenmis uygulama bulunamadi.
    echo         Once "build.bat build" calistirin.
)
goto END_INTERACTIVE

REM --------------------------------------------------------------------------
REM  Ortak bitis noktasi. CLI modunda process sonlanir; menude once duraklar.
REM --------------------------------------------------------------------------
:END_INTERACTIVE
if not defined RC set "RC=0"
if "%CLI%"=="1" exit /b !RC!
pause >nul
goto FINISH_MENU

:FINISH_MENU
set "CLI=0"
goto MENU

:EXIT_SCRIPT
echo Kapatiliyor.
exit /b 0