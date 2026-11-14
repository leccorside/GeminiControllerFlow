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

# Cache de upload do web-ext: se ficar de uma execução anterior, o AMO responde "already been submitted".
Remove-Item .amo-upload-uuid -Force -ErrorAction SilentlyContinue
$inicio = Get-Date
npx --yes web-ext@8 sign `
    --channel=unlisted `
    --artifacts-dir web-ext-artifacts `
    --ignore-files "CONTEXTO.md" "README.md" "scripts/**" "updates/**" ".gitattributes" ".gitignore" ".env" ".amo-upload-uuid" "logo-*.png" "*.md"
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
Remove-Item Env:WEB_EXT_API_SECRET -ErrorAction SilentlyContinue

# ---------- Publicação para atualização automática ----------
# O Firefox consulta o update_url do manifest (updates/updates.json no GitHub) e instala sozinho a versão nova.
# Aqui só preparamos os arquivos; eles entram no ar quando o commit for enviado (git push) para a branch main.
$manifest = Get-Content manifest.json -Raw | ConvertFrom-Json
$gecko = $manifest.browser_specific_settings.gecko
$baseRaw = ($gecko.update_url -replace '/updates\.json$', '')
New-Item -ItemType Directory -Force updates | Out-Null
$nomeXpi = "geminicontrollerflow-$versao.xpi"
Copy-Item $xpi.FullName "updates\$nomeXpi" -Force
$hash = (Get-FileHash "updates\$nomeXpi" -Algorithm SHA256).Hash.ToLower()

$arquivoUpdates = "updates\updates.json"
$versoes = @()
if (Test-Path $arquivoUpdates) {
    $atual = Get-Content $arquivoUpdates -Raw | ConvertFrom-Json
    $versoes = @($atual.addons.($gecko.id).updates | Where-Object { $_.version -ne $versao })
}
$versoes += [pscustomobject]@{
    version     = $versao
    update_link = "$baseRaw/$nomeXpi"
    update_hash = "sha256:$hash"
    applications = @{ gecko = @{ strict_min_version = $gecko.strict_min_version } }
}
# Mantém só as 5 versões mais recentes (e seus .xpi) para o repositório não crescer à toa.
$versoes = @($versoes | Sort-Object { [version]$_.version } | Select-Object -Last 5)
$manter = $versoes | ForEach-Object { "geminicontrollerflow-$($_.version).xpi" }
Get-ChildItem updates -Filter "geminicontrollerflow-*.xpi" | Where-Object { $manter -notcontains $_.Name } | Remove-Item -Force

$saida = @{ addons = @{ $gecko.id = @{ updates = $versoes } } } | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $raiz $arquivoUpdates), $saida + "`n", (New-Object Text.UTF8Encoding $false))
Write-Host "Atualização preparada em updates\ (versão $versao)." -ForegroundColor Green
Write-Host "Faça commit e push de updates\ para a main: o Firefox instala sozinho na próxima verificação." -ForegroundColor Cyan

# Instalação manual (só necessária uma vez, ou com -Instalar).
if ($args -contains "-Instalar") {
    $firefox = @("C:\Program Files\Mozilla Firefox\firefox.exe", "C:\Program Files (x86)\Mozilla Firefox\firefox.exe") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
    $uri = ([Uri]$xpi.FullName).AbsoluteUri
    if ($firefox) { & $firefox -new-tab $uri } else { Start-Process $xpi.FullName }
    Write-Host "Aberto no Firefox — confirme em 'Adicionar'." -ForegroundColor Cyan
}
