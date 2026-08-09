<#
.SYNOPSIS
    Run a test suite in a visible browser, then build and open the evidence record.

.DESCRIPTION
    The normal pass is headless: it exists to produce verdicts, fast. This runs
    the same specs with the browser on screen, paced so a person can follow what
    it is doing, narrating each step into the page as it happens, and finishes by
    assembling everything the run recorded into one HTML document.

    Nothing here is a separate implementation of the suite. The specs, the
    assertions and the evidence format are the ones the headless pass uses; watch
    mode only changes whether anyone is watching.

    Every suite below is read-only. It opens records and reads fields; it submits
    no form and clicks no action that would transition a task.

.PARAMETER Suite
    sf   the seven Salesforce Lightning cases from TEST-CASES-INTEGRATION.md
         (default)
    sn   the executable ServiceNow cases

    To watch a SINGLE case and get its Word evidence record, use
    `npm test TC-INT-020` instead - see run-case.mjs. This script is for
    running a whole suite.

.PARAMETER Grep
    Run only cases whose title matches this pattern, e.g. -Grep 'TC-INT-051'.
    This is how you watch one case rather than a suite.

.PARAMETER Pace
    Milliseconds to hold after narrating each step. Default 900.

.PARAMETER SlowMo
    Milliseconds Playwright waits before each action. Default 320.

.PARAMETER Hold
    Milliseconds to hold on the final verdict before the browser closes.

.PARAMETER Stamp
    Leave the narration panel visible in the screenshots. Off by default — an
    evidence image should show the application, not the harness driving it.

.PARAMETER NoReport
    Skip building the HTML evidence record.

.EXAMPLE
    .\watch.ps1
    .\watch.ps1 -Suite sf -Pace 1500 -SlowMo 600
    .\watch.ps1 -Suite sn
#>
[CmdletBinding()]
param(
    [ValidateSet('sf', 'sn')]
    [string]$Suite = 'sf',

    [string]$Grep,
    [int]$Pace = 900,
    [int]$SlowMo = 320,
    [int]$Hold = 0,
    [switch]$Stamp,
    [switch]$NoReport
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

# Node was installed after most shells on this machine were created, so a fresh
# session does not have it on PATH and npx fails with a bare "not recognized"
# that reads like a broken install. Rebuild PATH from the registry.
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path', 'User')

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "node is not on PATH even after rebuilding it from the registry. Install Node LTS and re-run."
}

# --- what each suite is -------------------------------------------------------
$suites = @{
    'sf' = @{ Project = 'sf-ui'; Spec = 'specs/integration-ui.spec.ts';   Results = 'results/cases'; Title = 'CAF Compliance - Salesforce UI test evidence' }
    'sn' = @{ Project = 'sn';    Spec = 'specs/servicenow-cases.spec.ts'; Results = 'results/cases'; Title = 'CAF Compliance - ServiceNow test evidence' }
}
$s = $suites[$Suite]

# --- watch mode ---------------------------------------------------------------
$env:WATCH = '1'
$env:WATCH_PACE = "$Pace"
$env:WATCH_SLOWMO = "$SlowMo"
if ($Hold -gt 0) { $env:WATCH_HOLD = "$Hold" } else { Remove-Item Env:\WATCH_HOLD -ErrorAction SilentlyContinue }
if ($Stamp) { $env:WATCH_STAMP = '1' } else { Remove-Item Env:\WATCH_STAMP -ErrorAction SilentlyContinue }

$reportPath = Join-Path $PSScriptRoot ((Split-Path $s.Results -Parent) + '/evidence-report.html')

Write-Host ""
Write-Host "  CAF test automation - watch mode" -ForegroundColor Cyan
Write-Host "  suite    $Suite  ($($s.Spec), project $($s.Project))"
Write-Host "  pacing   $Pace ms per step, $SlowMo ms per action"
if ($Grep) { Write-Host "  filter   $Grep" }
Write-Host "  A browser window will open. Read-only - nothing is submitted." -ForegroundColor DarkGray
Write-Host ""

# --- run ----------------------------------------------------------------------
# Stamped before the run so the report can cover only what this run executed.
# results/cases is an archive: reporting on the whole of it after running one
# case would produce a document claiming cases that were never executed.
$startedAt = (Get-Date).ToUniversalTime().AddSeconds(-2).ToString('o')

$playwrightArgs = @('playwright', 'test', $s.Spec, "--project=$($s.Project)")
if ($Grep) { $playwrightArgs += @('--grep', $Grep) }

& npx @playwrightArgs
$testExit = $LASTEXITCODE

# --- evidence record ----------------------------------------------------------
# Built whether the run passed or failed. A failed case is evidence too, and a
# report that only appears on success is the one you cannot show anybody.
if (-not $NoReport) {
    $caseDir = Join-Path $PSScriptRoot $s.Results
    if (Test-Path $caseDir) {
        Write-Host ""
        & node 'report/build-report.mjs' --in $s.Results --out $reportPath --title $s.Title --since $startedAt --open
    }
    else {
        Write-Warning "No results at $caseDir - nothing to report on."
    }
}

Write-Host ""
if ($testExit -eq 0) {
    Write-Host "  Run finished, every case passed." -ForegroundColor Green
}
else {
    Write-Host "  Run finished with failures - see the report and the verdicts above." -ForegroundColor Yellow
}
Write-Host "  Report      $reportPath"
Write-Host "  Screenshots $(Join-Path $PSScriptRoot 'evidence')"
Write-Host "  Recordings  $(Join-Path $PSScriptRoot 'test-results')"
Write-Host ""

exit $testExit
