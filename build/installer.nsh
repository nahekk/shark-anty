; Custom NSIS steps for the Shark{anty} installer (included by electron-builder).

; On uninstall (not on update) ask whether to remove profiles and settings too.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Usunąć także wszystkie profile, cookies i ustawienia Shark{anty}?$\r$\n$\r$\nAlso delete all Shark{anty} profiles, cookies and settings?" /SD IDNO IDNO shark_keep_data
      RMDir /r "$APPDATA\Shark{anty}"
    shark_keep_data:
  ${endIf}
!macroend
