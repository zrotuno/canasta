# Minimal static file server. Exists because this machine has no Node and no
# Python, and ES modules will not load over file:// -- they need real HTTP.
# Usage: powershell -ExecutionPolicy Bypass -File tools\serve.ps1 [-Port 8080]
param([int]$Port = 8080, [string]$Root = (Split-Path $PSScriptRoot -Parent))

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "Serving $Root at http://localhost:$Port/"

$mime = @{
  '.html' = 'text/html'; '.js' = 'text/javascript'; '.css' = 'text/css';
  '.json' = 'application/json'; '.svg' = 'image/svg+xml'; '.png' = 'image/png';
  '.webmanifest' = 'application/manifest+json'; '.ico' = 'image/x-icon';
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $rel = [Uri]::UnescapeDataString($ctx.Request.Url.LocalPath).TrimStart('/')
  if ($rel -eq '' -or $rel.EndsWith('/')) { $rel += 'index.html' }
  $file = Join-Path $Root $rel

  # Refuse anything that escapes the project root.
  $full = [IO.Path]::GetFullPath($file)
  if (-not $full.StartsWith([IO.Path]::GetFullPath($Root))) {
    $ctx.Response.StatusCode = 403
  } elseif (Test-Path $full -PathType Leaf) {
    $ext = [IO.Path]::GetExtension($full).ToLower()
    $type = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
    $bytes = [IO.File]::ReadAllBytes($full)
    $ctx.Response.ContentType = "$type; charset=utf-8"
    $ctx.Response.Headers.Add('Cache-Control', 'no-store')
    # Without an explicit length the response goes out chunked, which service
    # worker script fetches refuse.
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $ctx.Response.StatusCode = 404
  }
  $ctx.Response.Close()
}
