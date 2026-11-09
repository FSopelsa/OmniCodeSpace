# Starts Omni's dev server. If OMNI_PROXY is set, it first makes sure that proxy answers,
# so runs routed through it fail here instead of hanging later.
$ErrorActionPreference = 'Stop'
$proxy = $env:OMNI_PROXY
function Test-Proxy { try { Invoke-WebRequest "$proxy/health" -UseBasicParsing -TimeoutSec 2 | Out-Null; $true } catch { $false } }

if ($proxy -and -not (Test-Proxy)) {
    # The logon task that starts Headroom on 8787 on this PC. Other PCs may not have it.
    $task = 'tokless-headroom-proxy'
    if (-not (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue)) { throw "$proxy isn't answering and there's no '$task' task to start it. Start the proxy, or clear OMNI_PROXY." }
    Write-Host "Starting $task ..."
    Start-ScheduledTask -TaskName $task
    $end = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $end -and -not (Test-Proxy)) { Start-Sleep 1 }
    if (-not (Test-Proxy)) { throw "$proxy still isn't answering after 30 seconds. Check the proxy's log." }
}
if ($proxy) { Write-Host "Proxy OK: $proxy" }

Set-Location (Split-Path $PSScriptRoot)
npm run dev
