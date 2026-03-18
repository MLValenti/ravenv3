$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$modelDir = Join-Path $scriptDir "models\\en_US\\libritts_r\\medium"

New-Item -ItemType Directory -Force -Path $modelDir | Out-Null

$files = @(
  @{
    Name = "en_US-libritts_r-medium.onnx"
    Url  = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/libritts_r/medium/en_US-libritts_r-medium.onnx"
  },
  @{
    Name = "en_US-libritts_r-medium.onnx.json"
    Url  = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/libritts_r/medium/en_US-libritts_r-medium.onnx.json"
  }
)

foreach ($file in $files) {
  $target = Join-Path $modelDir $file.Name
  Write-Host "Downloading $($file.Name) ..."
  Invoke-WebRequest -Uri $file.Url -OutFile $target
}

Write-Host ""
Write-Host "Downloaded voice files:"
Get-ChildItem $modelDir | Select-Object Name, Length
