$Host.UI.RawUI.WindowTitle = 'DSIE Codex: Local Job Intelligence Pipeline'
Clear-Host

$ProjectRoot = 'C:\job_search_project'
$SweepLog    = Join-Path $ProjectRoot 'sweep_log.json'

function Append-SweepLog {
    param(
        [string]$Phase,
        [string]$Status,
        [string]$Message,
        [int]$ExitCode = 0
    )
    $entry = [ordered]@{
        timestamp = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')
        phase     = $Phase
        status    = $Status
        message   = $Message
        exit_code = $ExitCode
    }
    $existing = @()
    if (Test-Path $SweepLog) {
        try { $existing = Get-Content $SweepLog -Raw | ConvertFrom-Json } catch { $existing = @() }
    }
    $combined = @($existing) + @([pscustomobject]$entry)
    if ($combined.Count -gt 200) { $combined = $combined[($combined.Count - 200)..($combined.Count - 1)] }
    $combined | ConvertTo-Json -Depth 4 | Set-Content -Path $SweepLog -Encoding UTF8
}

Write-Host ''
Write-Host '=================================================================' -ForegroundColor Cyan
Write-Host '   DSIE CODEX - Local Job Intelligence Pipeline' -ForegroundColor White
Write-Host '=================================================================' -ForegroundColor Cyan
Write-Host "  Run started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor DarkGray
Write-Host ''

Set-Location -Path $ProjectRoot

Write-Host '[1/2] INITIATING PHASE 1: JobSpy + ATS + JIT Extraction...' -ForegroundColor Green
.\.venv\Scripts\python.exe phase_1_extraction.py
$Phase1Exit = $LASTEXITCODE

if ($Phase1Exit -ne 0) {
    $msg = "Phase 1 exited with code $Phase1Exit"
    Write-Host "[ERROR] $msg" -ForegroundColor Red
    Append-SweepLog -Phase 'phase_1' -Status 'error' -Message $msg -ExitCode $Phase1Exit
} else {
    Append-SweepLog -Phase 'phase_1' -Status 'success' -Message 'Extraction completed' -ExitCode 0
}

Write-Host ''
Write-Host '=================================================================' -ForegroundColor Cyan

Write-Host '[2/2] INITIATING PHASE 2: Cleansing, Scoring and Enrichment...' -ForegroundColor Green
.\.venv\Scripts\python.exe phase_2_cleansing.py
$Phase2Exit = $LASTEXITCODE

if ($Phase2Exit -ne 0) {
    $msg = "Phase 2 exited with code $Phase2Exit"
    Write-Host "[ERROR] $msg" -ForegroundColor Red
    Append-SweepLog -Phase 'phase_2' -Status 'error' -Message $msg -ExitCode $Phase2Exit
} else {
    $statsMsg = 'Scoring complete'
    if (Test-Path (Join-Path $ProjectRoot 'cleansing_stats.json')) {
        try {
            $stats = Get-Content (Join-Path $ProjectRoot 'cleansing_stats.json') -Raw | ConvertFrom-Json
            $statsMsg = "kept=$($stats.total_kept) dropped=$($stats.total_dropped) total=$($stats.total_processed)"
        } catch { }
    }
    Append-SweepLog -Phase 'phase_2' -Status 'success' -Message $statsMsg -ExitCode 0
}

Write-Host ''
Write-Host '=================================================================' -ForegroundColor Cyan
Write-Host "  PIPELINE COMPLETE: $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Green
Write-Host '  Dashboard: http://127.0.0.1:8090' -ForegroundColor Yellow
Write-Host "  Sweep log: $SweepLog" -ForegroundColor DarkGray
Write-Host '=================================================================' -ForegroundColor Cyan
Write-Host ''
