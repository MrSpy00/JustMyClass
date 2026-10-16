; =============================================================================
; JustMyClass - Ozel NSIS Kurulum ve Tam Kaldirma Kancalari (installer.nsh)
; =============================================================================
; Bu dosya electron-builder tarafindan NSIS derleyicisine dogrudan dahil edilir.
; Kaldirma (Uninstall) sirasinda JustMyClass kurulum klasoru ($INSTDIR) dahil
; olmak uzere JustMyClass ismi gecen tum klasor, dosya, kisayol ve kayit defteri
; izlerini eksiksiz olarak temizler.
; =============================================================================

!macro customInit
  ; Yeni kurulum veya guncelleme oncesinde acik kalan JustMyClass surecini kapat.
  nsExec::ExecToStack 'taskkill /F /IM "JustMyClass.exe" /T'
!macroend

!macro customUnInit
  ; Kaldirma baslamadan once calisan JustMyClass surecini sonlandir ve
  ; calisma dizinini $TEMP'e tasi ki $INSTDIR kilitli kalmasin.
  nsExec::ExecToStack 'taskkill /F /IM "JustMyClass.exe" /T'
  Sleep 400
  SetOutPath "$TEMP"
!macroend

!macro customUnInstall
  DetailPrint "JustMyClass surecleri ve kilitleri kontrol ediliyor..."
  nsExec::ExecToStack 'taskkill /F /IM "JustMyClass.exe" /T'
  Sleep 300

  ; Calisma dizinini $TEMP olarak ayarla; aksi halde Windows $INSTDIR klasorunu
  ; uninstaller calisirken silmeye izin vermez.
  SetOutPath "$TEMP"

  DetailPrint "JustMyClass uygulama verileri ve onbellek tamamen temizleniyor..."
  RMDir /r "$APPDATA\JustMyClass"
  RMDir /r "$APPDATA\justmyclass"
  RMDir /r "$LOCALAPPDATA\JustMyClass"
  RMDir /r "$LOCALAPPDATA\justmyclass"
  RMDir /r "$LOCALAPPDATA\justmyclass-updater"
  RMDir /r "$TEMP\JustMyClass"
  RMDir /r "$TEMP\justmyclass"

  DetailPrint "JustMyClass kisayollari ve baslat menusu kayitlari kaldiriliyor..."
  SetShellVarContext current
  Delete "$DESKTOP\JustMyClass.lnk"
  Delete "$SMPROGRAMS\JustMyClass.lnk"
  RMDir /r "$SMPROGRAMS\JustMyClass"

  SetShellVarContext all
  Delete "$DESKTOP\JustMyClass.lnk"
  Delete "$SMPROGRAMS\JustMyClass.lnk"
  RMDir /r "$SMPROGRAMS\JustMyClass"
  SetShellVarContext current

  DetailPrint "JustMyClass kayit defteri anahtarlari temizleniyor..."
  DeleteRegKey HKCU "Software\JustMyClass"
  DeleteRegKey HKLM "Software\JustMyClass"
  DeleteRegKey HKCU "Software\com.aegissoft.justmyclass"
  DeleteRegKey HKLM "Software\com.aegissoft.justmyclass"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.aegissoft.justmyclass"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.aegissoft.justmyclass"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "JustMyClass"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.aegissoft.justmyclass"

  DetailPrint "JustMyClass kurulum klasoru ($INSTDIR) tamamen siliniyor..."
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  Delete "$INSTDIR\*.*"
  RMDir /r /REBOOTOK "$INSTDIR"
  RMDir /r /REBOOTOK "$LOCALAPPDATA\Programs\JustMyClass"
  RMDir /r /REBOOTOK "$LOCALAPPDATA\Programs\justmyclass"
  RMDir /r /REBOOTOK "$PROGRAMFILES\JustMyClass"
  RMDir /r /REBOOTOK "$PROGRAMFILES64\JustMyClass"

  ; Uninstaller.exe kendi klasoru ($INSTDIR) icinden calistiginda Windows,
  ; uninstaller.exe tamamen kapanana kadar bos $INSTDIR klasorunu silmeyebilir.
  ; Uninstaller kapandiktan ~1 saniye sonra gizli arka plan komutuyla $INSTDIR
  ; ve tum JustMyClass klasorlerinin 100% silinmesini garanti altina aliriz.
  ExecShell "" "$SYSDIR\cmd.exe" '/C ping 127.0.0.1 -n 2 > nul & rmdir /s /q "$INSTDIR" > nul 2>&1 & rmdir /s /q "$LOCALAPPDATA\Programs\JustMyClass" > nul 2>&1 & rmdir /s /q "$LOCALAPPDATA\Programs\justmyclass" > nul 2>&1 & rmdir /s /q "$APPDATA\JustMyClass" > nul 2>&1 & rmdir /s /q "$LOCALAPPDATA\JustMyClass" > nul 2>&1 & rmdir /s /q "$LOCALAPPDATA\justmyclass-updater" > nul 2>&1' SW_HIDE
!macroend

