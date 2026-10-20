# Resize Instant_Aboard_logo.jpg into the PNG sizes the PWA / tab icon expect.
# Run from repo root:
#   powershell -ExecutionPolicy Bypass -File scripts/build-icons.ps1

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$srcPath = Join-Path $root "public\icons\Instant_Aboard_logo.jpg"
$outDir = Join-Path $root "public\icons"

if (-not (Test-Path $srcPath)) {
  throw "Missing $srcPath"
}

$src = New-Object System.Drawing.Bitmap $srcPath
$bg = $src.GetPixel(2, 2)
Write-Host ("source {0}x{1}" -f $src.Width, $src.Height)

function Save-Icon([int]$size, [string]$name, [double]$inner = 1) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear($bg)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $box = [int][Math]::Round($size * $inner)
  $x = [int][Math]::Round(($size - $box) / 2)
  $g.DrawImage($src, $x, $x, $box, $box)
  $dest = Join-Path $outDir $name
  $tmp = Join-Path $outDir ("." + $name + ".tmp")
  if (Test-Path $tmp) { Remove-Item -Force $tmp }
  $bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  if (Test-Path $dest) { Remove-Item -Force $dest }
  Move-Item -Force $tmp $dest
  Write-Host "wrote $name ($size) $((Get-Item $dest).Length) bytes"
}

Save-Icon 192 "icon-192.png" 1
Save-Icon 512 "icon-512.png" 1
Save-Icon 180 "apple-touch-icon.png" 1
# Android maskable icons crop ~10% per side; keep the clock in the safe zone.
Save-Icon 512 "icon-512-maskable.png" 0.8

$src.Dispose()
Write-Host "done"
