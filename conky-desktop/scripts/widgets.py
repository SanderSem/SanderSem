#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Допоміжні блоки для Conky-віджетів робочого столу.

Кожна підкоманда друкує готовий текст у форматі Conky (з ${color}, ${font}, ${goto}).
Використання:  widgets.py <команда> [аргумент]

Команди: os, date, calendar, vpn, backup, updates, cpu_temp, gpu <поле>,
         weather, weather-refresh, power
"""
import calendar
import datetime as dt
import glob
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.realpath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache"), "conky-desk")
os.makedirs(CACHE, exist_ok=True)

# ---------- палітра та шрифти (мають збігатися з *.conf) ----------
MUTED, TEXT, WHITE = "#8793b0", "#c9d3e6", "#e3e9f7"
BLUE, GREEN, ORANGE, RED, DIM = "#6e9cf5", "#5fd3a0", "#f2b25c", "#f26d6d", "#4a5676"
F_LBL = "Ubuntu:size=7"
F_BIG = "Ubuntu Light:size=17"
F_HUGE = "Ubuntu Light:size=26"
F_BOLD = "Ubuntu:bold:size=9"
# Ubuntu не має символів погоди/маркерів, тому для них окремий шрифт (DejaVu є в Mint за замовчуванням)
F_ICON = "DejaVu Sans:size=12"
F_ICON_BIG = "DejaVu Sans:size=24"
F_DOT = "DejaVu Sans:size=8"

DAYS = ["понеділок", "вівторок", "середа", "четвер", "п’ятниця", "субота", "неділя"]
DAYS_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "нд"]
MONTHS_GEN = ["січня", "лютого", "березня", "квітня", "травня", "червня",
              "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"]
MONTHS_NOM = ["січень", "лютий", "березень", "квітень", "травень", "червень",
              "липень", "серпень", "вересень", "жовтень", "листопад", "грудень"]


def col(color, text):
    return "${color %s}%s" % (color, text)


def font(spec, text):
    return "${font %s}%s${font}" % (spec, text)


def goto(x):
    return "${goto %d}" % x


def esc(text):
    """Екранує $ для Conky."""
    return str(text).replace("$", "$$")


def label(text, extra=""):
    return "${voffset 9}" + col(MUTED, font(F_LBL, text)) + extra


def plural(n, one, few, many):
    n10, n100 = n % 10, n % 100
    if n10 == 1 and n100 != 11:
        return one
    if 2 <= n10 <= 4 and not 12 <= n100 <= 14:
        return few
    return many


def load_config():
    cfg = {
        "CITY": "Київ", "LAT": "50.4501", "LON": "30.5234",
        "CPU_TDP_W": "65", "CPU_IDLE_W": "8", "BASE_W": "35",
        "BACKUP_DIR": "",
    }
    try:
        with open(os.path.join(ROOT, "config.env"), encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                cfg[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return cfg


def read(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return default


def run(cmd, timeout=4):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


# ---------- блоки ----------
def cmd_os(_arg):
    pretty = "Linux"
    for line in (read("/etc/os-release", "") or "").splitlines():
        if line.startswith("PRETTY_NAME="):
            pretty = line.split("=", 1)[1].strip('"')
    print(col(MUTED, esc(pretty)))


def cmd_date(_arg):
    d = dt.date.today()
    print(col(BLUE, DAYS[d.weekday()] + ", ")
          + col(WHITE, "%d %s " % (d.day, MONTHS_GEN[d.month - 1]))
          + col(ORANGE, str(d.year)))


def cmd_calendar(_arg):
    today = dt.date.today()
    weeks = calendar.Calendar(firstweekday=0).monthdatescalendar(today.year, today.month)
    step = 41
    out = [label("КАЛЕНДАР") + "${alignr}" + col(TEXT, "%s %d" % (MONTHS_NOM[today.month - 1], today.year))]
    head = "${voffset 4}"
    for i, name in enumerate(DAYS_SHORT):
        head += goto(i * step + 8) + col(MUTED if i < 5 else DIM, name)
    out.append(head)
    for week in weeks:
        row = ""
        for i, day in enumerate(week):
            x = i * step + (14 if day.day < 10 else 8)
            if day == today:
                cell = col(ORANGE, font(F_BOLD, day.day))
            elif day.month != today.month:
                cell = col(DIM, day.day)
            elif i >= 5:
                cell = col(MUTED, day.day)
            else:
                cell = col(WHITE, day.day)
            row += goto(x) + cell
        out.append(row)
    print("\n".join(out))


def cmd_vpn(_arg):
    active = False
    for line in run(["nmcli", "-t", "-f", "TYPE,STATE", "connection", "show", "--active"]).splitlines():
        if line.split(":")[0] in ("vpn", "wireguard"):
            active = True
    if not active:
        for pat in ("tun*", "wg*", "tailscale*", "proton*", "ppp*"):
            if glob.glob("/sys/class/net/" + pat):
                active = True
    print(col(GREEN, "увімкнено") if active else col(RED, "вимкнено"))


def last_snapshot(cfg):
    bases = [cfg["BACKUP_DIR"]] if cfg["BACKUP_DIR"] else []
    bases += glob.glob("/timeshift/snapshots*") + glob.glob("/timeshift-btrfs/snapshots*")
    best = None
    for base in bases:
        try:
            names = os.listdir(base)
        except OSError:
            continue
        for name in names:
            m = re.match(r"^(\d{4})-(\d\d)-(\d\d)_(\d\d)-(\d\d)-(\d\d)$", name)
            if m:
                stamp = dt.datetime(*map(int, m.groups()))
                if best is None or stamp > best:
                    best = stamp
    return best


def cmd_backup(_arg):
    snap = last_snapshot(load_config())
    out = label("РЕЗЕРВНА КОПІЯ")
    if snap is None:
        print(out + "\n" + col(MUTED, "Timeshift: знімків не знайдено") + "${alignr}" + col(RED, font(F_BIG, "—")))
        return
    days = (dt.date.today() - snap.date()).days
    color = GREEN if days <= 2 else ORANGE if days <= 7 else RED
    text = "сьогодні" if days == 0 else "%d %s" % (days, plural(days, "день", "дні", "днів"))
    print(out + "\n" + col(MUTED, "остання: " + snap.strftime("%d.%m.%Y"))
          + "${alignr}" + col(color, font(F_BIG, text)))


def cmd_updates(_arg):
    lines = [l for l in run(["apt", "list", "--upgradable"], timeout=25).splitlines() if "upgradable" in l]
    n = len(lines)
    print(col(GREEN if n == 0 else ORANGE, font(F_BIG, n)))


def cmd_cpu_temp(_arg):
    for hw in sorted(glob.glob("/sys/class/hwmon/hwmon*")):
        if read(hw + "/name") in ("k10temp", "coretemp", "zenpower", "cpu_thermal"):
            raw = read(hw + "/temp1_input")
            if raw and raw.isdigit():
                print("%d°C" % (int(raw) // 1000))
                return
    for zone in sorted(glob.glob("/sys/class/thermal/thermal_zone*")):
        if read(zone + "/type") in ("x86_pkg_temp", "cpu-thermal"):
            raw = read(zone + "/temp")
            if raw and raw.lstrip("-").isdigit():
                print("%d°C" % (int(raw) // 1000))
                return
    print("—")


# ---------- GPU (NVIDIA через nvidia-smi, AMD через sysfs) ----------
def gpu_query():
    path = os.path.join(CACHE, "gpu.json")
    try:
        if time.time() - os.path.getmtime(path) < 1.5:
            with open(path) as f:
                return json.load(f)
    except (OSError, ValueError):
        pass
    data = None
    out = run(["nvidia-smi",
               "--query-gpu=temperature.gpu,clocks.current.graphics,utilization.gpu,power.draw,power.limit,fan.speed",
               "--format=csv,noheader,nounits"], timeout=3).strip().splitlines()
    if out:
        def num(s):
            try:
                return float(s.strip())
            except ValueError:
                return None
        v = [num(x) for x in out[0].split(",")]
        if len(v) == 6:
            data = dict(zip(("temp", "clock", "util", "power", "limit", "fan"), v))
    if data is None:
        for card in sorted(glob.glob("/sys/class/drm/card[0-9]")):
            dev = card + "/device"
            if read(dev + "/vendor") != "0x1002":
                continue
            hw = (glob.glob(dev + "/hwmon/hwmon*") or [None])[0]

            def hwnum(name, div):
                raw = read(hw + "/" + name) if hw else None
                return int(raw) / div if raw and raw.isdigit() else None
            busy = read(dev + "/gpu_busy_percent")
            data = {
                "temp": hwnum("temp1_input", 1000),
                "clock": hwnum("freq1_input", 1e6),
                "util": float(busy) if busy and busy.isdigit() else None,
                "power": hwnum("power1_average", 1e6) or hwnum("power1_input", 1e6),
                "limit": hwnum("power1_cap", 1e6),
                "fan": None,
            }
            break
    if data is None:
        data = {}
    try:
        with open(path, "w") as f:
            json.dump(data, f)
    except OSError:
        pass
    return data


def cmd_gpu(field):
    field = field or "util"
    value = gpu_query().get(field)
    if value is None:
        print(0 if field == "util" else "—")
    elif field == "temp":
        print("%d°C" % round(value))
    elif field == "clock":
        print("%d MHz" % round(value))
    else:
        print(int(round(value)))


# ---------- погода (Open-Meteo, без ключа) ----------
WMO = {0: ("ясно", "☀"), 1: ("переважно ясно", "☀"), 2: ("мінлива хмарність", "☁"), 3: ("похмуро", "☁"),
       45: ("туман", "≋"), 48: ("паморозь", "≋"),
       51: ("легка мряка", "☂"), 53: ("мряка", "☂"), 55: ("сильна мряка", "☂"),
       56: ("крижана мряка", "☂"), 57: ("крижана мряка", "☂"),
       61: ("невеликий дощ", "☂"), 63: ("дощ", "☂"), 65: ("сильний дощ", "☂"),
       66: ("крижаний дощ", "☂"), 67: ("крижаний дощ", "☂"),
       71: ("невеликий сніг", "❄"), 73: ("сніг", "❄"), 75: ("сильний сніг", "❄"), 77: ("снігові зерна", "❄"),
       80: ("злива", "☂"), 81: ("злива", "☂"), 82: ("сильна злива", "☂"),
       85: ("снігопад", "❄"), 86: ("сильний снігопад", "❄"),
       95: ("гроза", "⚡"), 96: ("гроза з градом", "⚡"), 99: ("гроза з градом", "⚡")}
WEATHER_FILE = os.path.join(CACHE, "weather.json")


def cmd_weather_refresh(_arg):
    cfg = load_config()
    query = urllib.parse.urlencode({
        "latitude": cfg["LAT"], "longitude": cfg["LON"], "timezone": "auto", "forecast_days": 5,
        "wind_speed_unit": "kmh",
        "current": "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min"})
    req = urllib.request.Request("https://api.open-meteo.com/v1/forecast?" + query,
                                 headers={"User-Agent": "conky-desk"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.load(resp)
    tmp = WEATHER_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"ts": time.time(), "data": data}, f)
    os.replace(tmp, WEATHER_FILE)


def deg(value):
    return "%d°" % round(value)


def cmd_weather(_arg):
    cfg = load_config()
    cached = None
    try:
        with open(WEATHER_FILE, encoding="utf-8") as f:
            cached = json.load(f)
    except (OSError, ValueError):
        pass
    if cached is None or time.time() - cached["ts"] > 1800:
        # оновлюємо у фоні, щоб Conky не блокувався на мережі
        subprocess.Popen([sys.executable, os.path.realpath(__file__), "weather-refresh"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    head = label("ПОГОДА") + "${alignr}" + col(TEXT, esc(cfg["CITY"]))
    if cached is None:
        print(head + "\n" + col(MUTED, "завантаження…"))
        return
    cur, daily = cached["data"]["current"], cached["data"]["daily"]
    text, icon = WMO.get(cur["weather_code"], ("—", "☁"))
    today = dt.date.today()
    out = [head,
           col(MUTED, "%s, %d %s" % (DAYS[today.weekday()], today.day, MONTHS_GEN[today.month - 1])),
           col(BLUE, font(F_ICON_BIG, icon + " ")) + col(WHITE, font(F_HUGE, deg(cur["temperature_2m"]))),
           col(TEXT, text),
           col(MUTED, "відчувається як %s" % deg(cur["apparent_temperature"])),
           col(MUTED, "вітер %d км/год" % round(cur["wind_speed_10m"]))]
    step = 58
    rows = ["${voffset 6}", "", "", ""]
    for i, day in enumerate(daily["time"][:5]):
        d = dt.date.fromisoformat(day)
        x = goto(i * step + 4)
        _, ic = WMO.get(daily["weather_code"][i], ("", "☁"))
        rows[0] += x + col(MUTED, DAYS_SHORT[d.weekday()])
        rows[1] += x + col(BLUE, font(F_ICON, ic))
        rows[2] += x + col(WHITE, deg(daily["temperature_2m_max"][i]))
        rows[3] += x + col(MUTED, deg(daily["temperature_2m_min"][i]))
    print("\n".join(out + rows))


# ---------- орієнтовне споживання ----------
def cpu_util():
    def snap():
        with open("/proc/stat") as f:
            v = list(map(int, f.readline().split()[1:]))
        return sum(v), v[3] + v[4]
    state = os.path.join(CACHE, "cpustat.json")
    cur, prev = snap(), None
    try:
        with open(state) as f:
            prev = json.load(f)
        if time.time() - prev[2] > 10:
            prev = None
    except (OSError, ValueError, IndexError):
        prev = None
    if prev is None:
        time.sleep(0.25)
        prev, cur = (cur[0], cur[1], 0), snap()
    try:
        with open(state, "w") as f:
            json.dump([cur[0], cur[1], time.time()], f)
    except OSError:
        pass
    total, idle = cur[0] - prev[0], cur[1] - prev[1]
    return max(0.0, min(100.0, 100.0 * (total - idle) / total)) if total > 0 else 0.0


def cmd_power(_arg):
    cfg = load_config()
    gpu = gpu_query()
    util = cpu_util()
    tdp, idle, base = float(cfg["CPU_TDP_W"]), float(cfg["CPU_IDLE_W"]), float(cfg["BASE_W"])
    cpu_w = idle + (tdp - idle) * util / 100.0
    gpu_w = gpu.get("power") or 0.0
    total = cpu_w + gpu_w + base

    def dot(color, name, watts):
        return col(color, font(F_DOT, "● ")) + col(MUTED, name) + "${alignr}" + col(TEXT, "%d W" % round(watts))

    out = [label("ЖИВЛЕННЯ") + "${alignr}" + col(DIM, "оцінка"),
           col(ORANGE, font(F_BIG, "≈ %d" % round(total))) + col(ORANGE, " W"),
           dot(BLUE, "Процесор", cpu_w),
           dot(GREEN, "Відеокарта", gpu_w),
           dot(MUTED, "Решта (оцінка)", base)]
    if gpu.get("limit"):
        fan = gpu.get("fan")
        fan_txt = "—" if fan is None else ("%d%% (стоїть)" % fan if fan == 0 else "%d%%" % fan)
        out.append("${voffset 4}" + col(MUTED, "відеокарта") + "${alignr}"
                   + col(TEXT, "%d / %d W" % (round(gpu_w), round(gpu["limit"]))))
        out.append(col(MUTED, "вентилятор") + "${alignr}" + col(TEXT, fan_txt))
    print("\n".join(out))


COMMANDS = {
    "os": cmd_os, "date": cmd_date, "calendar": cmd_calendar, "vpn": cmd_vpn,
    "backup": cmd_backup, "updates": cmd_updates, "cpu_temp": cmd_cpu_temp, "gpu": cmd_gpu,
    "weather": cmd_weather, "weather-refresh": cmd_weather_refresh, "power": cmd_power,
}

if __name__ == "__main__":
    name = sys.argv[1] if len(sys.argv) > 1 else ""
    if name not in COMMANDS:
        sys.exit("Використання: widgets.py {%s}" % "|".join(COMMANDS))
    try:
        COMMANDS[name](sys.argv[2] if len(sys.argv) > 2 else "")
    except Exception as exc:  # віджет не повинен ламати Conky
        print(col(RED, "помилка: %s" % esc(exc)))
