# Assina a extensão na Mozilla (canal "unlisted": não aparece na loja) e instala no Firefox de forma definitiva.
# O Firefox normal (canal release) só aceita instalação permanente de extensões assinadas.
#
# Uso (no PowerShell, na pasta do projeto):
#   powershell -ExecutionPolicy Bypass -File scripts\assinar-e-instalar.ps1
#
# As credenciais da API do addons.mozilla.org são lidas das variáveis WEB_EXT_API_KEY / WEB_EXT_API_SECRET
# ou pedidas no terminal. Elas não são gravadas em nenhum arquivo.
# Gere em: https://addons.mozilla.org/pt-BR/developers/addon/api/key/

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

if (-not $env:WEB_EXT_API_KEY) {
    $env:WEB_EXT_API_KEY = Read-Host "Emissor JWT (JWT issuer, ex.: user:12345:678)"
}
if (-not $env:WEB_EXT_API_SECRET) {
    $seguro = Read-Host "Segredo JWT (JWT secret)" -AsSecureString
    $env:WEB_EXT_API_SECRET = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro))
}

$versao = (Get-Content manifest.json -Raw | ConvertFrom-Json).version
Write-Host "Assinando a versão $versao (pode levar alguns minutos)..." -ForegroundColor Cyan

npx --yes web-ext@8 sign `
    --channel=unlisted `
    --artifacts-dir web-ext-artifacts `
    --ignore-files "CONTEXTO.md" "README.md" "scripts/**" ".gitattributes" ".gitignore"

if ($LASTEXITCODE -ne 0) {
    Write-Host "Falha ao assinar. Se o erro disser que a versão já existe, aumente 'version' no manifest.json e rode de novo." -ForegroundColor Red
    exit 1
}

$xpi = Get-ChildItem web-ext-artifacts -Filter *.xpi | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $xpi) { Write-Host "Arquivo .xpi assinado não encontrado em web-ext-artifacts." -ForegroundColor Red; exit 1 }

Write-Host "Assinado: $($xpi.FullName)" -ForegroundColor Green
Write-Host "Abrindo no Firefox — confirme em 'Adicionar' na janela que aparecer." -ForegroundColor Cyan

$firefox = @("C:\Program Files\Mozilla Firefox\firefox.exe", "C:\Program Files (x86)\Mozilla Firefox\firefox.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if ($firefox) { & $firefox $xpi.FullName } else { Start-Process $xpi.FullName }

Remove-Item Env:WEB_EXT_API_SECRET -ErrorAction SilentlyContinue
