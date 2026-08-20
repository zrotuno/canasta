# Generates the Canasta app icons: a gold 50 on table green.
# System.Drawing ships with Windows, so this needs no toolchain.
# Usage: powershell -ExecutionPolicy Bypass -File canasta\tools\make-icons.ps1

Add-Type -AssemblyName System.Drawing

$outDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'assets\icons'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

$felt = [System.Drawing.Color]::FromArgb(18, 60, 44)
$gold = [System.Drawing.Color]::FromArgb(216, 165, 58)

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
  $bg = New-Object System.Drawing.SolidBrush $felt
  if ($squareBackground) {
    $g.FillRectangle($bg, 0, 0, $size, $size)
  } else {
    $p = New-RoundedPath 0 0 $size $size ($size * 0.22)
    $g.FillPath($bg, $p); $p.Dispose()
  }

  # Thin gold rule just inside the edge.
  $pen = New-Object System.Drawing.Pen($gold, [single]($size * 0.022))
  $inset = $size * 0.085
  $frame = New-RoundedPath $inset $inset ($size - 2 * $inset) ($size - 2 * $inset) ($size * 0.13)
  $g.DrawPath($pen, $frame)
  $frame.Dispose(); $pen.Dispose()

  $goldBrush = New-Object System.Drawing.SolidBrush $gold
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center

  # The word only reads at larger sizes; below 128px it turns to mush and the
  # numerals get the whole face to themselves.
  $withWord = $size -ge 128

  $fifty = New-Object System.Drawing.Font('Georgia', ($size * 0.42), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $box = if ($withWord) {
    New-Object System.Drawing.RectangleF(0, ($size * 0.06), $size, ($size * 0.62))
  } else {
    New-Object System.Drawing.RectangleF(0, 0, $size, $size)
  }
  $g.DrawString('50', $fifty, $goldBrush, $box, $fmt)

  if ($withWord) {
    $years = New-Object System.Drawing.Font('Georgia', ($size * 0.095), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $yBox = New-Object System.Drawing.RectangleF(0, ($size * 0.68), $size, ($size * 0.16))
    $g.DrawString('YEARS', $years, $goldBrush, $yBox, $fmt)
    $years.Dispose()
  }

  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $fifty.Dispose(); $g.Dispose(); $bmp.Dispose()
  Write-Host "wrote $path"
}

New-Icon 192 (Join-Path $outDir 'icon-192.png') $false
New-Icon 512 (Join-Path $outDir 'icon-512.png') $false
New-Icon 180 (Join-Path $outDir 'apple-touch-icon.png') $true
New-Icon 32  (Join-Path $outDir 'favicon-32.png') $false
