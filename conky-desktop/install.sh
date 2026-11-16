#!/usr/bin/env bash
# Встановлення Conky-віджетів у ~/.config/conky-desk + автозапуск для Cinnamon/MATE/Xfce.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.config/conky-desk"

if ! command -v conky >/dev/null; then
  echo "Conky не знайдено. Встановіть: sudo apt install conky-all" >&2
  exit 1
fi
if [ "${XDG_SESSION_TYPE:-x11}" = "wayland" ]; then
  echo "УВАГА: сесія Wayland. Conky надійно працює лише під X11 (оберіть сесію Cinnamon на екрані входу)." >&2
fi

mkdir -p "$DEST/scripts" "$HOME/.config/autostart"
cp "$SRC"/left.conf "$SRC"/center.conf "$SRC"/right.conf "$SRC"/start.sh "$DEST/"
cp "$SRC"/scripts/widgets.py "$DEST/scripts/"
# Не перезаписуємо вже налаштований config.env
[ -f "$DEST/config.env" ] || cp "$SRC/config.env" "$DEST/config.env"
chmod +x "$DEST/start.sh" "$DEST/scripts/widgets.py"

cat > "$HOME/.config/autostart/conky-desk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Conky desktop widgets
Exec=$DEST/start.sh --delay
X-GNOME-Autostart-enabled=true
EOF

echo "Готово. Відредагуйте місто в $DEST/config.env, потім запустіть: $DEST/start.sh"
