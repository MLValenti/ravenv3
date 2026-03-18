param(
  [ValidateSet("efficientdet_lite0", "efficientdet_lite2", "efficientdet_lite4")]
  [string]$Variant = "efficientdet_lite2"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$modelsDir = Join-Path $repoRoot "public\models"
if (!(Test-Path $modelsDir)) {
  New-Item -ItemType Directory -Path $modelsDir | Out-Null
}

$urlMap = @{
  "efficientdet_lite0" = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite"
  "efficientdet_lite2" = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/int8/1/efficientdet_lite2.tflite"
  "efficientdet_lite4" = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite4/int8/1/efficientdet_lite4.tflite"
}

$target = Join-Path $modelsDir "$Variant.tflite"
$url = $urlMap[$Variant]

Write-Host "Downloading $Variant to $target"
Invoke-WebRequest -Uri $url -OutFile $target

$bytes = (Get-Item $target).Length
Write-Host "Saved $bytes bytes"
