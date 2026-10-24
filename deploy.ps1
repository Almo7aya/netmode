<#
.SYNOPSIS
  Copy netmode to an OpenWrt router and install (or upgrade) it. Needs ssh key access as root.
.EXAMPLE
  ./deploy.ps1 -Router root@192.168.1.1          # install / upgrade
  ./deploy.ps1 -Router root@192.168.1.1 -DryRun  # only print the mwan3 rules it would build
  $env:NETMODE_ROUTER = "root@10.0.1.1"; ./deploy.ps1
#>
param(
	[string]$Router = $(if ($env:NETMODE_ROUTER) { $env:NETMODE_ROUTER } else { "root@192.168.1.1" }),
	[switch]$DryRun
)
$ErrorActionPreference = "Stop"
$ssh = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=5")

$pkg = Join-Path ([IO.Path]::GetTempPath()) "netmode-deploy.tar.gz"
tar -czf $pkg -C $PSScriptRoot files install.sh uninstall.sh
if ($LASTEXITCODE) { throw "tar failed" }

$dir = "/tmp/netmode-src-" + (Get-Date -Format "yyyyMMddHHmmss")
scp -O @ssh $pkg "${Router}:/tmp/netmode-deploy.tar.gz"
if ($LASTEXITCODE) { throw "scp failed" }

$prefix = if ($DryRun) { "DRYRUN=1 " } else { "" }
ssh @ssh $Router "mkdir -p $dir && tar -xzf /tmp/netmode-deploy.tar.gz -C $dir && sed -i 's/\r`$//' $dir/install.sh && ${prefix}sh $dir/install.sh"
if ($LASTEXITCODE) { throw "install failed" }
