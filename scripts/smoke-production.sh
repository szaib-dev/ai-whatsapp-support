#!/usr/bin/env bash
set -Eeuo pipefail
web="${WEB_URL:-https://codetic.netawaz.pk}"
api="${API_URL:-https://api.netawaz.pk}"
for path in / /privacy /terms /data-deletion /support /status /robots.txt /sitemap.xml; do
 status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$web$path")"
 [[ "$status" == 200 ]] || { echo "Failed $path ($status)" >&2; exit 1; }
done
headers="$(curl --silent --show-error --head "$web/admin")"
grep -qi 'location: /admin/login' <<< "$headers" || { echo 'Admin route must redirect anonymous visitors.' >&2; exit 1; }
curl --fail --silent --show-error "$api/ready"
printf '\n%s\n' 'Public routes, admin redirect and API readiness passed. Complete the authenticated and real-device checks in DEPLOYMENT.md.'
