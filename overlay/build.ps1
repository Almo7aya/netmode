<#
Builds the netmode ping overlay (WPF on the .NET Framework 4.8 that is part of Windows 10/11: one .exe, nothing to
install). The C# compiler is the one in the .NET SDK; it compiles against the Framework's own assemblies, so no
packages are downloaded.
  .\build.ps1        dist\NetmodeOverlay.exe
#>
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$csc = Get-ChildItem "$env:ProgramFiles\dotnet\sdk" -Recurse -Filter csc.dll | Where-Object { $_.FullName -match 'Roslyn\\bincore' } |
	Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $csc) { throw 'No C# compiler: install the .NET SDK' }
$fw = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319"
$refs = @('mscorlib', 'System', 'System.Core', 'System.Xaml', 'System.Web.Extensions', 'System.Windows.Forms', 'System.Drawing') |
	ForEach-Object { "/reference:$fw\$_.dll" }
$refs += @('WindowsBase', 'PresentationCore', 'PresentationFramework') | ForEach-Object { "/reference:$fw\WPF\$_.dll" }
$src = (Get-ChildItem "$root\src\*.cs").FullName
New-Item -ItemType Directory -Force "$root\dist" | Out-Null
$exe = "$root\dist\NetmodeOverlay.exe"

function Compile([string[]]$extra) {
	dotnet $csc /nologo /noconfig /nostdlib+ /langversion:latest /optimize+ /target:winexe /out:$exe /win32manifest:$root\app.manifest `
		@extra @refs $src
	if ($LASTEXITCODE) { throw 'build failed' }
}

# the first build draws the icon for the second
Compile @()
Start-Process -FilePath $exe -ArgumentList '--write-icon', "`"$root\dist\NetmodeOverlay.ico`"" -Wait
Compile @("/win32icon:$root\dist\NetmodeOverlay.ico")
Get-Item $exe | ForEach-Object { '{0}  {1:N0} KB' -f $_.Name, ($_.Length / 1KB) }
