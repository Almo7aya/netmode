#!/bin/sh
# Copy netmode to an OpenWrt router and install (or upgrade) it. Needs ssh key access as root.
#   ./deploy.sh root@192.168.1.1          install / upgrade
#   DRYRUN=1 ./deploy.sh root@192.168.1.1 only print the mwan3 rules it would build
#   NETMODE_ROUTER=root@10.0.1.1 ./deploy.sh
set -e
ROUTER=${1:-${NETMODE_ROUTER:-root@192.168.1.1}}
cd "$(dirname "$0")"
pkg=$(mktemp -t netmode-deploy.XXXXXX)
trap 'rm -f "$pkg"' EXIT
tar -czf "$pkg" files install.sh uninstall.sh
dir=/tmp/netmode-src-$(date +%Y%m%d%H%M%S)
scp -O -o BatchMode=yes "$pkg" "$ROUTER:/tmp/netmode-deploy.tar.gz"
ssh -o BatchMode=yes "$ROUTER" "mkdir -p $dir && tar -xzf /tmp/netmode-deploy.tar.gz -C $dir && ${DRYRUN:+DRYRUN=1 }sh $dir/install.sh"
