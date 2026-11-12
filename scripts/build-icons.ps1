# Rasterize public/icons/app-mark.svg into the PNG / ICO sizes the PWA and tab icon expect.
# Run from repo root:
#   powershell -ExecutionPolicy Bypass -File scripts/build-icons.ps1

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$srcPath = Join-Path $root "public\icons\app-mark.svg"
$outDir = Join-Path $root "public\icons"

if (-not (Test-Path $srcPath)) {
  throw "Missing $srcPath"
}

function Parse-HexColor([string]$hex) {
  $h = $hex.Trim().TrimStart("#")
  if ($h.Length -eq 3) {
    $h = "{0}{0}{1}{1}{2}{2}" -f $h[0], $h[1], $h[2]
  }
  $r = [Convert]::ToInt32($h.Substring(0, 2), 16)
  $g = [Convert]::ToInt32($h.Substring(2, 2), 16)
  $b = [Convert]::ToInt32($h.Substring(4, 2), 16)
  return [System.Drawing.Color]::FromArgb(255, $r, $g, $b)
}

function Get-Attr([System.Xml.XmlNode]$node, [string]$name, [string]$fallback) {
  $a = $node.Attributes.GetNamedItem($name)
  if ($a -and $a.Value) { return $a.Value }
  return $fallback
}

function Get-PathLines([string]$d) {
  $lines = New-Object System.Collections.Generic.List[object]
  $tokens = [regex]::Matches($d, "[MmLlHhVv]|-?\d*\.?\d+") | ForEach-Object { $_.Value }
  $i = 0
  $x = 0.0
  $y = 0.0
  $cmd = "M"
  while ($i -lt $tokens.Count) {
    $t = $tokens[$i]
    if ($t -match "^[MmLlHhVv]$") {
      $cmd = $t
      $i++
      if ($i -ge $tokens.Count) { break }
    }
    switch -CaseSensitive ($cmd) {
      "M" {
        $x = [double]$tokens[$i]; $y = [double]$tokens[$i + 1]; $i += 2
        $cmd = "L"
      }
      "m" {
        $x += [double]$tokens[$i]; $y += [double]$tokens[$i + 1]; $i += 2
        $cmd = "l"
      }
      "L" {
        $nx = [double]$tokens[$i]; $ny = [double]$tokens[$i + 1]; $i += 2
        $lines.Add(@($x, $y, $nx, $ny)) | Out-Null
        $x = $nx; $y = $ny
      }
      "l" {
        $nx = $x + [double]$tokens[$i]; $ny = $y + [double]$tokens[$i + 1]; $i += 2
        $lines.Add(@($x, $y, $nx, $ny)) | Out-Null
        $x = $nx; $y = $ny
      }
      "H" {
        $nx = [double]$tokens[$i]; $i++
        $lines.Add(@($x, $y, $nx, $y)) | Out-Null
        $x = $nx
      }
      "h" {
        $nx = $x + [double]$tokens[$i]; $i++
        $lines.Add(@($x, $y, $nx, $y)) | Out-Null
        $x = $nx
      }
      "V" {
        $ny = [double]$tokens[$i]; $i++
        $lines.Add(@($x, $y, $x, $ny)) | Out-Null
        $y = $ny
      }
      "v" {
        $ny = $y + [double]$tokens[$i]; $i++
        $lines.Add(@($x, $y, $x, $ny)) | Out-Null
        $y = $ny
      }
      default { throw "Unsupported SVG path command '$cmd'" }
    }
  }
  return $lines
}

$xml = New-Object System.Xml.XmlDocument
$xml.PreserveWhitespace = $true
$xml.Load($srcPath)
$rootNode = $xml.SelectSingleNode("/*[local-name()='svg']")
if (-not $rootNode) { throw "No svg root in $srcPath" }

$vb = (Get-Attr $rootNode "viewBox" "0 0 24 24") -split "\s+"
$vbX = [double]$vb[0]
$vbY = [double]$vb[1]
$vbW = [double]$vb[2]
$vbH = [double]$vb[3]

$strokeCss = Get-Attr $rootNode "stroke" "#efe8dc"
$strokeWidth = [double](Get-Attr $rootNode "stroke-width" "2")
$bg = Parse-HexColor "#12110f"
$ink = Parse-HexColor $strokeCss

$circles = New-Object System.Collections.Generic.List[object]
$lines = New-Object System.Collections.Generic.List[object]
foreach ($node in $xml.SelectNodes("//*[local-name()='rect' or local-name()='circle' or local-name()='path']")) {
  $name = $node.LocalName
  if ($name -eq "rect") {
    $fill = Get-Attr $node "fill" ""
    if ($fill -and $fill -ne "none") { $bg = Parse-HexColor $fill }
    continue
  }
  if ($name -eq "circle") {
    $circles.Add(@(
      [double](Get-Attr $node "cx" "0"),
      [double](Get-Attr $node "cy" "0"),
      [double](Get-Attr $node "r" "0")
    )) | Out-Null
    continue
  }
  foreach ($seg in Get-PathLines (Get-Attr $node "d" "")) {
    $lines.Add($seg) | Out-Null
  }
}

Write-Host ("source viewBox {0}x{1} circles={2} lines={3}" -f $vbW, $vbH, $circles.Count, $lines.Count)

function New-MarkBitmap([int]$size, [double]$inner) {
  $ss = 4
  $big = $size * $ss
  $bmp = New-Object System.Drawing.Bitmap $big, $big, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear($bg)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

  $box = $big * $inner
  $ox = ($big - $box) / 2.0
  $oy = ($big - $box) / 2.0
  $sx = $box / $vbW
  $sy = $box / $vbH
  $g.TranslateTransform([float]($ox - $vbX * $sx), [float]($oy - $vbY * $sy))
  $g.ScaleTransform([float]$sx, [float]$sy)

  $pen = New-Object System.Drawing.Pen $ink, ([float]$strokeWidth)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $pen.Alignment = [System.Drawing.Drawing2D.PenAlignment]::Center

  foreach ($c in $circles) {
    $cx = $c[0]; $cy = $c[1]; $r = $c[2]
    $g.DrawEllipse($pen, [float]($cx - $r), [float]($cy - $r), [float](2 * $r), [float](2 * $r))
  }
  foreach ($ln in $lines) {
    $g.DrawLine($pen, [float]$ln[0], [float]$ln[1], [float]$ln[2], [float]$ln[3])
  }

  $pen.Dispose()
  $g.Dispose()

  $out = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $og = [System.Drawing.Graphics]::FromImage($out)
  $og.Clear($bg)
  $og.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $og.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $og.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $og.DrawImage($bmp, 0, 0, $size, $size)
  $og.Dispose()
  $bmp.Dispose()
  return $out
}

function Save-Png([int]$size, [string]$dest, [double]$inner) {
  $bmp = New-MarkBitmap $size $inner
  $dir = Split-Path -Parent $dest
  $tmp = Join-Path $dir ("." + [IO.Path]::GetFileName($dest) + ".tmp")
  if (Test-Path $tmp) { Remove-Item -Force $tmp }
  $bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  if (Test-Path $dest) { Remove-Item -Force $dest }
  Move-Item -Force $tmp $dest
  Write-Host ("wrote {0} ({1}) {2} bytes" -f [IO.Path]::GetFileName($dest), $size, (Get-Item $dest).Length)
}

function Save-Ico([int]$size, [string]$dest, [double]$inner) {
  $bmp = New-MarkBitmap $size $inner
  $pngMs = New-Object System.IO.MemoryStream
  $bmp.Save($pngMs, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $png = $pngMs.ToArray()
  $pngMs.Dispose()

  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter $ms
  $bw.Write([uint16]0)
  $bw.Write([uint16]1)
  $bw.Write([uint16]1)
  $bw.Write([byte]$size)
  $bw.Write([byte]$size)
  $bw.Write([byte]0)
  $bw.Write([byte]0)
  $bw.Write([uint16]1)
  $bw.Write([uint16]32)
  $bw.Write([uint32]$png.Length)
  $bw.Write([uint32]22)
  $bw.Write($png)
  $bw.Flush()
  $bytes = $ms.ToArray()
  $bw.Dispose()
  $ms.Dispose()

  $dir = Split-Path -Parent $dest
  $tmp = Join-Path $dir ("." + [IO.Path]::GetFileName($dest) + ".tmp")
  if (Test-Path $tmp) { Remove-Item -Force $tmp }
  [System.IO.File]::WriteAllBytes($tmp, $bytes)
  if (Test-Path $dest) { Remove-Item -Force $dest }
  Move-Item -Force $tmp $dest
  Write-Host ("wrote {0} ({1}) {2} bytes" -f [IO.Path]::GetFileName($dest), $size, (Get-Item $dest).Length)
}

# "any" / apple: viewBox inset so stroke tips survive OS squircle masks.
# maskable: ~20% padding each side (safe zone for Android adaptive icons).
$any = 0.84
$maskable = 0.60

Save-Png 192 (Join-Path $outDir "icon-192.png") $any
Save-Png 512 (Join-Path $outDir "icon-512.png") $any
Save-Png 192 (Join-Path $outDir "icon-192-maskable.png") $maskable
Save-Png 512 (Join-Path $outDir "icon-512-maskable.png") $maskable
Save-Png 180 (Join-Path $root "public\apple-touch-icon.png") $any
Save-Ico 32 (Join-Path $root "src\app\favicon.ico") $any

Write-Host "done"
