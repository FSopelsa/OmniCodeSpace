# Renders each prototype to a PNG next to its HTML, using the installed Chrome.
$chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
foreach ($html in Get-ChildItem "$PSScriptRoot\*.html") {
    $png = [IO.Path]::ChangeExtension($html.FullName, 'png')
    & $chrome --headless=new --disable-gpu --hide-scrollbars --window-size=1440,900 --virtual-time-budget=4000 "--screenshot=$png" "file:///$($html.FullName -replace '\\','/')" 2>$null | Out-Null
    while (-not (Test-Path $png)) { Start-Sleep -Milliseconds 200 }
}
