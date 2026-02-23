param(
  [switch]$Apply,
  [switch]$IncludeNodeModules,
  [switch]$IncludeReports
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-IsExcludedPath {
  param(
    [string]$FullName,
    [switch]$AllowNodeModules
  )

  $normalized = $FullName.ToLowerInvariant()

  if ($normalized -match "[\\/]+\.venv[\\/]+" -or $normalized -match "[\\/]+venv[\\/]+") {
    return $true
  }

  if (-not $AllowNodeModules -and $normalized -match "[\\/]+node_modules[\\/]+") {
    return $true
  }

  return $false
}

function Get-ItemSizeBytes {
  param(
    [System.IO.FileSystemInfo]$Item
  )

  if ($Item.PSIsContainer) {
    $total = 0L
    Get-ChildItem -Path $Item.FullName -Recurse -Force -File -ErrorAction SilentlyContinue | ForEach-Object {
      $total += $_.Length
    }
    return $total
  }

  return [int64]$Item.Length
}

function Format-Bytes {
  param(
    [int64]$Bytes
  )

  if ($Bytes -lt 1KB) { return "$Bytes B" }
  if ($Bytes -lt 1MB) { return ("{0:N2} KB" -f ($Bytes / 1KB)) }
  if ($Bytes -lt 1GB) { return ("{0:N2} MB" -f ($Bytes / 1MB)) }
  return ("{0:N2} GB" -f ($Bytes / 1GB))
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Write-Host "Project root: $root"
Write-Host "Mode: $(if ($Apply) { "APPLY (delete)" } else { "DRY-RUN (preview only)" })"

$directoryNames = @("__pycache__", ".next")
if ($IncludeReports) {
  $directoryNames += "reports"
}

$filePatterns = @("*.pyc", "next.out.log", "next.err.log")

$found = New-Object System.Collections.Generic.List[System.IO.FileSystemInfo]
$seen = New-Object "System.Collections.Generic.HashSet[string]"

# Match directories by exact name.
Get-ChildItem -Path $root -Recurse -Force -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  if ($directoryNames -notcontains $_.Name) {
    return
  }
  if (Test-IsExcludedPath -FullName $_.FullName -AllowNodeModules:$IncludeNodeModules) {
    return
  }
  if ($seen.Add($_.FullName)) {
    $found.Add($_)
  }
}

# Match files by pattern.
foreach ($pattern in $filePatterns) {
  Get-ChildItem -Path $root -Recurse -Force -File -Filter $pattern -ErrorAction SilentlyContinue | ForEach-Object {
    if (Test-IsExcludedPath -FullName $_.FullName -AllowNodeModules:$IncludeNodeModules) {
      return
    }
    if ($seen.Add($_.FullName)) {
      $found.Add($_)
    }
  }
}

if ($found.Count -eq 0) {
  Write-Host "No cleanup targets found."
  exit 0
}

$rawTargets = $found | Sort-Object FullName
$selected = New-Object System.Collections.Generic.List[System.IO.FileSystemInfo]
$selectedDirs = New-Object System.Collections.Generic.List[string]

foreach ($item in $rawTargets) {
  $path = $item.FullName
  $isChildOfPickedDir = $false
  foreach ($dir in $selectedDirs) {
    if ($path.StartsWith($dir + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
      $isChildOfPickedDir = $true
      break
    }
  }
  if ($isChildOfPickedDir) {
    continue
  }

  $selected.Add($item)
  if ($item.PSIsContainer) {
    $selectedDirs.Add($path)
  }
}

$targets = $selected | Sort-Object FullName
$totalBytes = 0L

Write-Host ""
Write-Host "Targets:"
foreach ($item in $targets) {
  $size = Get-ItemSizeBytes -Item $item
  $totalBytes += $size
  $kind = if ($item.PSIsContainer) { "DIR " } else { "FILE" }
  Write-Host ("- [{0}] {1} ({2})" -f $kind, $item.FullName, (Format-Bytes -Bytes $size))
}

Write-Host ""
Write-Host ("Total targets: {0}" -f $targets.Count)
Write-Host ("Estimated reclaim: {0}" -f (Format-Bytes -Bytes $totalBytes))

if (-not $Apply) {
  Write-Host ""
  Write-Host "Dry-run only. Nothing deleted."
  Write-Host "Run this to apply cleanup:"
  Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\cleanup_safe.ps1 -Apply"
  exit 0
}

Write-Host ""
Write-Host "Deleting..."
foreach ($item in $targets) {
  try {
    if ($item.PSIsContainer) {
      Remove-Item -Path $item.FullName -Recurse -Force -ErrorAction Stop
    } else {
      Remove-Item -Path $item.FullName -Force -ErrorAction Stop
    }
    Write-Host ("- Deleted: {0}" -f $item.FullName)
  } catch {
    Write-Warning ("Failed to delete: {0} ({1})" -f $item.FullName, $_.Exception.Message)
  }
}

Write-Host ""
Write-Host "Cleanup finished."
