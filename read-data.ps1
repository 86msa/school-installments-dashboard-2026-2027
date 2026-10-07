param([string]$DatabasePath, [string]$ProgramPath)
$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$programRoot = Join-Path $PSScriptRoot '..\ابتدائي 2027'
$databasePath = if ([string]::IsNullOrWhiteSpace($DatabasePath)) { Join-Path $programRoot 'data\alaa.mdb' } else { [System.IO.Path]::GetFullPath($DatabasePath) }
$programPath = if ([string]::IsNullOrWhiteSpace($ProgramPath)) { Join-Path $programRoot 'Ahleat School.exe' } else { [System.IO.Path]::GetFullPath($ProgramPath) }

function Get-ProgramDatabasePassword {
    param([string]$Path)
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $needle = [System.Text.Encoding]::Unicode.GetBytes(';pwd=')
    for ($i = 0; $i -le $bytes.Length - $needle.Length; $i++) {
        $found = $true
        for ($j = 0; $j -lt $needle.Length; $j++) {
            if ($bytes[$i + $j] -ne $needle[$j]) { $found = $false; break }
        }
        if (-not $found) { continue }
        $start = $i + $needle.Length
        $length = [Math]::Min(160, $bytes.Length - $start)
        $text = [System.Text.Encoding]::Unicode.GetString($bytes, $start, $length)
        $match = [System.Text.RegularExpressions.Regex]::Match($text, '^\x00[\x00-\x1F]\x00([!-~]{4,64})\x00')
        if ($match.Success) { return $match.Groups[1].Value }
    }
    throw 'تعذر قراءة مفتاح قاعدة البيانات من ملف البرنامج.'
}

function Read-Rows {
    param([System.Data.OleDb.OleDbConnection]$Connection, [string]$Sql)
    $command = $Connection.CreateCommand()
    $command.CommandText = $Sql
    $reader = $command.ExecuteReader()
    $rows = New-Object System.Collections.ArrayList
    try {
        while ($reader.Read()) {
            $row = [ordered]@{}
            for ($i = 0; $i -lt $reader.FieldCount; $i++) {
                $value = $reader.GetValue($i)
                if ($value -is [DBNull]) { $value = $null }
                elseif ($value -is [DateTime]) { $value = $value.ToString('yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture) }
                $row[$reader.GetName($i)] = $value
            }
            [void]$rows.Add($row)
        }
    } finally {
        $reader.Close()
        $command.Dispose()
    }
    return $rows.ToArray()
}

if (-not (Test-Path -LiteralPath $databasePath)) { throw 'ملف قاعدة البيانات غير موجود.' }
if (-not (Test-Path -LiteralPath $programPath)) { throw 'ملف البرنامج غير موجود.' }
$password = Get-ProgramDatabasePassword -Path $programPath
$connectionString = 'Provider=Microsoft.Jet.OLEDB.4.0;Data Source=' + $databasePath + ';Mode=Read;Jet OLEDB:Database Password=' + $password + ';'
$connection = New-Object System.Data.OleDb.OleDbConnection($connectionString)
try {
    $connection.Open()
    $payload = [ordered]@{
        students = @(Read-Rows $connection 'SELECT ID, sn, StName, Class, Shu, QstAll, DisCount, Baqi, DateNextQst, ValueNextQst, FatherMobile, MotherMobile, Deleted FROM St')
        receipts = @(Read-Rows $connection 'SELECT IDMain, ID, idd, Class, WslValue, WslDate, Notes FROM Wesolat')
        previousStudents = @(Read-Rows $connection 'SELECT ID, sn, StName, Class, QstAll, DisCount, Baqi, Deleted FROM Arch')
        previousReceipts = @(Read-Rows $connection 'SELECT ID, idd, WslValue, WslDate FROM ArchWsls')
        readAt = [DateTime]::UtcNow.ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
    }
    $payload | ConvertTo-Json -Depth 5 -Compress
} finally {
    if ($connection.State -eq 'Open') { $connection.Close() }
    $connection.Dispose()
}
