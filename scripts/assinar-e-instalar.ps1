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

# Lê as credenciais do .env, se existir (aceita "CHAVE=valor" ou "CHAVE: valor").
# Nomes aceitos: WEB_EXT_API_KEY / "Emissor JWT" e WEB_EXT_API_SECRET / "Segredo JWT".
if (Test-Path .env) {
    foreach ($linha in Get-Content .env -Encoding UTF8) {
        if ($linha -match '^\s*([^=:#]+?)\s*[=:]\s*(.+?)\s*$') {
            $nome = $Matches[1]; $valor = $Matches[2].Trim('"', "'")
            if ($nome -match '^(WEB_EXT_API_KEY|Emissor JWT)$' -and -not $env:WEB_EXT_API_KEY) { $env:WEB_EXT_API_KEY = $valor }
            if ($nome -match '^(WEB_EXT_API_SECRET|Segredo JWT)$' -and -not $env:WEB_EXT_API_SECRET) { $env:WEB_EXT_API_SECRET = $valor }
        }
    }
}

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

$inicio = Get-Date
npx --yes web-ext@8 sign `
    --channel=unlisted `
    --artifacts-dir web-ext-artifacts `
    --ignore-files "CONTEXTO.md" "README.md" "scripts/**" ".gitattributes" ".gitignore" ".env"
$codigo = $LASTEXITCODE

# O web-ext no Windows às vezes falha ao apagar a pasta temporária (ENOENT) DEPOIS de baixar o .xpi assinado.
# Por isso o sucesso é decidido pela existência de um .xpi novo da versão atual, e não só pelo código de saída.
$xpi = Get-ChildItem web-ext-artifacts -Filter "*-$versao.xpi" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -ge $inicio } | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $xpi) {
    Write-Host "Falha ao assinar (código $codigo). Se o erro disser que a versão já existe, aumente 'version' no manifest.json e rode de novo." -ForegroundColor Red
    Remove-Item Env:WEB_EXT_API_SECRET -ErrorAction SilentlyContinue
    exit 1
}
if ($codigo -ne 0) {
    Write-Host "O web-ext terminou com erro depois de baixar o arquivo assinado (limpeza de temporários); o .xpi está ok." -ForegroundColor Yellow
}

Write-Host "Assinado: $($xpi.FullName)" -ForegroundColor Green
Write-Host "Abrindo no Firefox — confirme em 'Adicionar' na janela que aparecer." -ForegroundColor Cyan

$firefox = @("C:\Program Files\Mozilla Firefox\firefox.exe", "C:\Program Files (x86)\Mozilla Firefox\firefox.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if ($firefox) { & $firefox $xpi.FullName } else { Start-Process $xpi.FullName }

Remove-Item Env:WEB_EXT_API_SECRET -ErrorAction SilentlyContinue
