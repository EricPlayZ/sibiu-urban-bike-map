#!/usr/bin/env bash
# Mapthecity edit JSON is archived by the existing stack backup, not by its own cron.
#
# Root cron, daily at 02:00:
#   /bin/bash /opt/stacks/backup_dbs.sh
# That script calls backup_folder on /opt/stacks/mapthecity/data
# before later database dumps, which currently abort on a missing container.
#
# Archive: /opt/stacks_db_bak/mapthecity/data-YYYYMMDD_HHMMSS.tar.gz
# Retention: newest 5, same as the other stack folders.
# Disk: /dev/sda8, the same disk as the live files. Not an off-site copy.
set -euo pipefail
echo "mapthecity edits are archived by /opt/stacks/backup_dbs.sh into /opt/stacks_db_bak/mapthecity/ (keep 5)."
