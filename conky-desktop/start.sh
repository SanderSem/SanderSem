#!/usr/bin/env bash
# Запускає (або перезапускає) три Conky-віджети.
DIR="$HOME/.config/conky-desk"

pkill -u "$USER" -f "conky -c $DIR/" 2>/dev/null
sleep 1
# Під час автозапуску чекаємо, поки Cinnamon завантажить робочий стіл
[ "${1:-}" = "--delay" ] && sleep 6

for part in left center right; do
  conky -c "$DIR/$part.conf" &
done
wait
