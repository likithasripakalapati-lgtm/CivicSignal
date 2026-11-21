param(
  [string]$DataDirectory = (Join-Path $PSScriptRoot '..\tessdata'),
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$resolvedDirectory = [System.IO.Path]::GetFullPath($DataDirectory)
$release = '4.1.0'
$baseUrl = "https://github.com/tesseract-ocr/tessdata_fast/raw/refs/tags/$release"
$expectedHashes = @{
  eng = '7D4322BD2A7749724879683FC3912CB542F19906C83BCC1A52132556427170B2'
  tel = 'D10691FDDD5B67802E1C12800EBB321D3B8BCD8D24A2AC3FF206F93188C04AB5'
}

New-Item -ItemType Directory -Path $resolvedDirectory -Force | Out-Null
foreach ($language in @('eng', 'tel')) {
  $destination = Join-Path $resolvedDirectory "$language.traineddata"
  if ((Test-Path -LiteralPath $destination) -and -not $Force) {
    $existing = Get-Item -LiteralPath $destination
    $existingHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
    if ($existing.Length -gt 500000 -and $existingHash -eq $expectedHashes[$language]) {
      Write-Host "Verified existing $language.traineddata ($($existing.Length) bytes, SHA256 $existingHash)."
      continue
    }
    throw "Existing $language trained data does not match the pinned release. Rerun with -Force to replace it."
  }

  $temporary = "$destination.download"
  try {
    Invoke-WebRequest -Uri "$baseUrl/$language.traineddata" -OutFile $temporary
    $download = Get-Item -LiteralPath $temporary
    if ($download.Length -le 500000) { throw "Downloaded $language data is unexpectedly small." }
    $hash = (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash
    if ($hash -ne $expectedHashes[$language]) { throw "Downloaded $language trained data did not match the pinned checksum." }
    Move-Item -LiteralPath $temporary -Destination $destination -Force
    Write-Host "Installed $language.traineddata ($($download.Length) bytes, SHA256 $hash)."
  } finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  }
}

foreach ($language in @('eng', 'tel')) {
  $file = Join-Path $resolvedDirectory "$language.traineddata"
  if (-not (Test-Path -LiteralPath $file) -or (Get-Item -LiteralPath $file).Length -le 500000) {
    throw "OCR data verification failed for $file"
  }
}

Write-Host "English and Telugu trained data verified at: $resolvedDirectory"
Write-Host "The default application path is server\tessdata. If you used another directory, set OCR_TESSDATA_DIR to this path in server/.env."
