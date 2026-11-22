# Dodge 게임용 초간단 로컬 웹서버 (http://localhost:8765)
# 웹앱(PWA) 설치는 http(s) 주소에서만 가능해서 이 서버로 게임을 엽니다.
param(
  [string]$Root = $PSScriptRoot,
  [int]$Port = 8765,
  [switch]$Open
)

$Root = [IO.Path]::GetFullPath($Root)
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try {
  $listener.Start()
} catch {
  Write-Host "포트 $Port 를 열 수 없습니다. 이미 서버가 실행 중일 수 있습니다." -ForegroundColor Yellow
  if ($Open) { Start-Process "http://localhost:$Port/" }
  exit 1
}

Write-Host "Dodge 서버 실행 중: http://localhost:$Port/"
Write-Host "이 창을 닫으면 서버가 종료됩니다."
if ($Open) { Start-Process "http://localhost:$Port/" }

$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.png'  = 'image/png'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ($rel -eq '') { $rel = 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $Root $rel))
    if ($file.StartsWith($Root) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $ctx.Response.ContentType = $(if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' })
      $ctx.Response.Headers.Add('Cache-Control', 'no-cache')
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
  } catch {
    $ctx.Response.StatusCode = 500
  } finally {
    $ctx.Response.Close()
  }
}
