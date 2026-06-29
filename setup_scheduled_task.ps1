# setup_scheduled_task.ps1
# Registers a Windows Task Scheduler task "JobSearch_DailySweep"
# Triggers: 07:00, 12:00, 18:00 daily
# On failure: logs exit code + timestamp to sweep_log.json
#
# Run this script once as Administrator to install the scheduled task.

$TaskName    = "JobSearch_DailySweep"
$ProjectRoot = "C:\job_search_project"
$ScriptPath  = Join-Path $ProjectRoot "Run_Job_Sweep.ps1"
$SweepLog    = Join-Path $ProjectRoot "sweep_log.json"
$PsExe       = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

# Remove existing task if present (idempotent)
Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false

Write-Host "Registering scheduled task '$TaskName'..." -ForegroundColor Cyan

# Build three daily triggers: 07:00, 12:00, 18:00
$triggers = @(
    New-ScheduledTaskTrigger -Daily -At "07:00",
    New-ScheduledTaskTrigger -Daily -At "12:00",
    New-ScheduledTaskTrigger -Daily -At "18:00"
)

# Action: run powershell -NonInteractive -File "Run_Job_Sweep.ps1"
$action = New-ScheduledTaskAction `
    -Execute $PsExe `
    -Argument "-NonInteractive -WindowStyle Hidden -File `"$ScriptPath`"" `
    -WorkingDirectory $ProjectRoot

# Run as current user (no password prompt needed)
$principal = New-ScheduledTaskPrincipal `
    -UserId     $env:USERNAME `
    -LogonType  Interactive `
    -RunLevel   Highest

# Settings: run if missed, don't stop on battery, execution time limit = 2h
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -RestartCount 1 `
    -RestartInterval (New-TimeSpan -Minutes 15) `
    -MultipleInstances IgnoreNew

# Register the task
Register-ScheduledTask `
    -TaskName  $TaskName `
    -Trigger   $triggers `
    -Action    $action `
    -Principal $principal `
    -Settings  $settings `
    -Force | Out-Null

Write-Host ""
Write-Host "SUCCESS: Task '$TaskName' registered." -ForegroundColor Green
Write-Host "  Triggers: 07:00, 12:00, 18:00 daily"
Write-Host "  Script:   $ScriptPath"
Write-Host "  Log:      $SweepLog"
Write-Host ""

# Verify
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    Write-Host "Task Status: $($task.State)" -ForegroundColor Yellow
} else {
    Write-Host "[WARNING] Task registration could not be verified." -ForegroundColor Red
}
