param([string]$InitialPath)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms

$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Filter = 'Access database (*.mdb)|*.mdb|All files (*.*)|*.*'
$dialog.CheckFileExists = $true
$dialog.Multiselect = $false
$dialog.RestoreDirectory = $true
if ($InitialPath) {
    $folder = Split-Path -Path $InitialPath -Parent
    if (Test-Path -LiteralPath $folder -PathType Container) { $dialog.InitialDirectory = $folder }
}

$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
try {
    if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
        [Console]::WriteLine($dialog.FileName)
    }
} finally {
    $dialog.Dispose()
    $owner.Dispose()
}
