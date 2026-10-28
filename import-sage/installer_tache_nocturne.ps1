# Crée la tâche planifiée Windows « Import Sage -> Airtable » (chaque nuit à 03:30).
# À lancer une fois, en PowerShell, depuis le dossier import-sage, sur le poste/serveur
# qui a accès au dossier partagé. Prérequis : Python 3.9+ installé ("py" dans le PATH).
$script = Join-Path $PSScriptRoot "import_sage.py"
$action  = New-ScheduledTaskAction -Execute "py" -Argument "-I `"$script`"" -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -Daily -At 03:30
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName "Import Sage -> Airtable (Pilotagem Supervisores)" `
  -Action $action -Trigger $trigger -Settings $settings -Description "Importe stock.csv et expedicoes.csv dans Airtable chaque nuit." -Force
Write-Host "Tâche créée. Test manuel :  py -I `"$script`""
