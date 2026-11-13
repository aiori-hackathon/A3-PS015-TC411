import math
def js_round(x: float) -> float:
    return math.floor(x + 0.5)
def median(values):
    if not values: return None
    s = sorted(values); mid = len(s) // 2
    raw = s[mid] if len(s) % 2 == 1 else (s[mid - 1] + s[mid]) / 2
    return js_round(raw * 10) / 10
def loss_percent(sent, received):
    if sent <= 0: return float("nan")
    return (sent - received) / sent * 100
