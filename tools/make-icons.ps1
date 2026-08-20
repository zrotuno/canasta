# Generates the app icons used by the web manifest and by iOS home screens.
# System.Drawing ships with Windows, so this needs no toolchain -- which
# matters on a machine with no Node and no Python.
# Usage: powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1

Add-Type -AssemblyName System.Drawing

$outDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'assets\icons'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

$felt = [System.Drawing.Color]::FromArgb(14, 74, 51)   # table green
$ink  = [System.Drawing.Color]::FromArgb(176, 32, 42)  # card red

function New-RoundedPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-Icon([int]$size, [string]$path, [bool]$squareBackground) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  # iOS masks its own corners, so the apple icon gets a full-bleed square.
  $bgBrush = New-Object System.Drawing.SolidBrush $felt
  if ($squareBackground) {
    $g.FillRectangle($bgBrush, 0, 0, $size, $size)
  } else {
    $bgPath = New-RoundedPath 0 0 $size $size ($size * 0.22)
    $g.FillPath($bgBrush, $bgPath)
    $bgPath.Dispose()
  }

  # A single card, tilted, with the R monogram.
  $cardW = $size * 0.50
  $cardH = $size * 0.68
  $cx = $size / 2.0
  $cy = $size / 2.0

  $g.TranslateTransform($cx, $cy)
  $g.RotateTransform(-8)

  $shadow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(60, 0, 0, 0))
  $shadowPath = New-RoundedPath (-$cardW / 2 + $size * 0.02) (-$cardH / 2 + $size * 0.02) $cardW $cardH ($size * 0.06)
  $g.FillPath($shadow, $shadowPath)
  $shadowPath.Dispose()

  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $cardPath = New-RoundedPath (-$cardW / 2) (-$cardH / 2) $cardW $cardH ($size * 0.06)
  $g.FillPath($white, $cardPath)
  $cardPath.Dispose()

  $font = New-Object System.Drawing.Font('Georgia', ($size * 0.40), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $inkBrush = New-Object System.Drawing.SolidBrush $ink
  $box = New-Object System.Drawing.RectangleF((-$cardW / 2), (-$cardH / 2), $cardW, $cardH)
  $g.DrawString('R', $font, $inkBrush, $box, $fmt)

  $g.ResetTransform()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)

  $font.Dispose(); $g.Dispose(); $bmp.Dispose()
  Write-Host "wrote $path"
}

New-Icon 192 (Join-Path $outDir 'icon-192.png') $false
New-Icon 512 (Join-Path $outDir 'icon-512.png') $false
New-Icon 180 (Join-Path $outDir 'apple-touch-icon.png') $true
New-Icon 32  (Join-Path $outDir 'favicon-32.png') $false
