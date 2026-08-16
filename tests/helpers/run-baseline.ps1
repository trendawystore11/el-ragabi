# =============================================================================
# run-baseline.ps1 — records the reference baseline of the 7 legacy harnesses.
# Runs tests/legacy/*.html via Chrome headless and writes tests/BASELINE.txt
# NOTE: ASCII-only content (PowerShell 5.1 reads no-BOM files as ANSI).
# =============================================================================
$ErrorActionPreference = 'Continue'
$exe = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$repo = 'C:\Users\m\opencode\system for blankts\react'
$legacy = Join-Path $repo 'tests\legacy'
$temp = Join-Path $env:TEMP 'opencode'

function Run-Dump($url, $budget) {
  $profile = Join-Path $temp ('ui-profile-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $profile -Force | Out-Null
  $dom = & $exe --headless --disable-gpu --no-sandbox --allow-file-access-from-files `
    --disable-background-networking --disable-extensions `
    --user-data-dir="$profile" --virtual-time-budget=$budget --dump-dom $url 2>&1 | Out-String
  Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
  return $dom
}

function Extract-Summary($dom) {
  $m = [regex]::Match($dom, '(?s)<pre id="o">(.*?)</pre>')
  $text = if ($m.Success) { $m.Groups[1].Value } else { '' }
  if (-not $text) {
    $s = [regex]::Match($dom, '(?s)<span class="num">([^<]*)</span>')
    $text = if ($s.Success) { $s.Groups[1].Value } else { '' }
  }
  $t = [regex]::Match($text, "Total:\s*(\d+)")
  $f = [regex]::Match($text, "Failed:\s*(\d+)")
  return @{
    Total  = if ($t.Success) { [int]$t.Groups[1].Value } else { -1 }
    Failed = if ($f.Success) { [int]$f.Groups[1].Value } else { -1 }
    Text   = ($text -replace "`n", ' ').Trim()
  }
}

$files = @(
  @{ Name = 'features-test';  File = 'features-test.html';       Budget = 25000 },
  @{ Name = 'e2e-runner';     File = 'e2e-runner.html';          Budget = 30000 },
  @{ Name = 'test-logic';     File = 'test-logic.html';          Budget = 30000 },
  @{ Name = 'audit-test';     File = 'audit-test.html';          Budget = 25000 },
  @{ Name = 'phone2-test';    File = 'phone2-test.html';         Budget = 20000 },
  @{ Name = 'orders-filter';  File = 'orders-filter-test.html';  Budget = 25000 },
  @{ Name = 'sandbox-test';   File = 'sandbox-test.html';        Budget = 30000 }
)

$lines = @()
$grandTotal = 0
$grandFailed = 0
foreach ($f in $files) {
  $url = 'file:///' + ((Join-Path $legacy $f.File) -replace '\\', '/' -replace ' ', '%20')
  $dom = Run-Dump $url $f.Budget
  $r = Extract-Summary $dom
  $status = if ($r.Failed -eq 0) { 'PASS' } else { 'FAIL' }
  $grandTotal += $r.Total
  $grandFailed += $r.Failed
  $line = ("{0} | {1} | Total={2} Failed={3}" -f $f.Name, $status, $r.Total, $r.Failed)
  $lines += $line
  Write-Output $line
}

$summary = "GRAND | " + $(if ($grandFailed -eq 0) { 'PASS' } else { 'FAIL' }) + " | Total=$grandTotal Failed=$grandFailed"
$lines += $summary
Write-Output $summary

$header = @(
  '# BASELINE - reference parity target (Phase 0)',
  ('# recorded: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')),
  '# Any phase that does NOT match Total/Failed below is FAILED.'
)
($header + $lines) | Set-Content -LiteralPath (Join-Path $repo 'tests\BASELINE.txt') -Encoding UTF8
Write-Output ('BASELINE.txt written: ' + (Join-Path $repo 'tests\BASELINE.txt'))

if ($grandFailed -ne 0) { exit 1 }
