# Pulls the newest image and restarts the container; the pa-data volume (database, API key, token) is kept.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$files = @('-f', 'docker-compose.yml')
if (Test-Path 'certs/zscaler-root-ca.crt') { $files += @('-f', 'docker-compose.certs.yml') }

docker compose @files pull
docker compose @files up -d
Start-Sleep -Seconds 3
docker compose @files logs --tail 30 assistant | Select-String 'token='
