# install-gpu-preference.ps1
# Persistently tell Windows to run Chrome and Edge on the HIGH-PERFORMANCE
# (discrete) GPU. This writes the same per-app preference the Settings UI uses
# (Settings > System > Display > Graphics). GpuPreference=2 == High performance.
# User-scoped (HKCU), reversible, no admin required.

$key = 'HKCU:\Software\Microsoft\DirectX\UserGpuPreferences'
if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }

$exes = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)

foreach ($exe in $exes) {
  if (Test-Path $exe) {
    New-ItemProperty -Path $key -Name $exe -Value 'GpuPreference=2;' -PropertyType String -Force | Out-Null
    Write-Host "High-performance GPU set for: $exe" -ForegroundColor Green
  }
}

Write-Host ""
Write-Host "Done. Fully close the browser (all windows) and reopen it, then load gpu.html." -ForegroundColor Cyan
Write-Host "To revert: Settings > System > Display > Graphics, or delete the values under" -ForegroundColor DarkGray
Write-Host "  $key" -ForegroundColor DarkGray
