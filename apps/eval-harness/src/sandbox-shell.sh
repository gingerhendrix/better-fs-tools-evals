#!/bin/bash
set -eu
# nodeCommandRunner invokes this file as <shell> -c <command>.
[ "$#" -eq 2 ] && [ "$1" = '-c' ]
workspace=${BFT_EVAL_WORKSPACE:?missing workspace}
unset BFT_EVAL_WORKSPACE
exec /usr/bin/bwrap \
  --unshare-all --die-with-parent --new-session \
  --ro-bind /usr /usr \
  --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib /lib64 \
  --proc /proc --dev /dev --tmpfs /tmp \
  --bind "$workspace" "$workspace" --chdir "$workspace" --remount-ro / \
  /bin/bash --noprofile --norc -c "$2"
