param([switch]$Release)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
    if ($Release) {
        node scripts/prepare-android.mjs --release
        if ($LASTEXITCODE -ne 0) { throw '发布配置校验失败' }
        foreach ($key in @('XF_KEYSTORE_PATH', 'XF_KEYSTORE_PASSWORD', 'XF_KEY_ALIAS', 'XF_KEY_PASSWORD')) {
            if (-not [Environment]::GetEnvironmentVariable($key)) { throw "缺少发布签名环境变量：$key" }
        }
    } else {
        node scripts/prepare-android.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Android资源构建失败' }
    }
    Push-Location android
    try {
        if ($Release) { & .\gradlew.bat assembleRelease } else { & .\gradlew.bat assembleDebug }
        if ($LASTEXITCODE -ne 0) { throw 'Android APK构建失败' }
    } finally { Pop-Location }
    $variant = if ($Release) { 'release' } else { 'debug' }
    $apkFile = Join-Path $projectRoot "android/app/build/outputs/apk/$variant/app-$variant.apk"
    java scripts/VerifyAndroidLayout.java $apkFile (Join-Path $projectRoot 'dist')
    if ($LASTEXITCODE -ne 0) { throw 'APK界面校验失败，安卓必须使用原网页布局' }
} finally { Pop-Location }
