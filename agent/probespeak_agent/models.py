from __future__ import annotations
from dataclasses import dataclass, fields, is_dataclass
from typing import Any, Optional

SOURCES = ("lab", "local_agent", "browser")

def camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(p.title() for p in rest)

@dataclass
class GatewayMeasurement:
    captured_at: str; source: str; method: str; insufficient_reason: Optional[str]
    gateway_ip: Optional[str]; attempts: Optional[int]; successes: Optional[int]
    rtt_ms: Optional[float]; raw_rtts_ms: list; check: str = "gateway"

@dataclass
class DnsMeasurement:
    captured_at: str; source: str; method: str; insufficient_reason: Optional[str]
    fresh_lookup: Optional[bool]; query_name: Optional[str]; resolver: Optional[str]
    resolved: Optional[bool]; time_ms: Optional[float]; answers: list
    error: Optional[str]; check: str = "dns"

@dataclass
class PacketLossMeasurement:
    captured_at: str; source: str; method: str; insufficient_reason: Optional[str]
    target: Optional[str]; sent: Optional[int]; received: Optional[int]
    loss_pct: Optional[float]; raw_rtts_ms: list; check: str = "packet_loss"

@dataclass
class CongestionMeasurement:
    captured_at: str; source: str; method: str; insufficient_reason: Optional[str]
    target: Optional[str]; unloaded_attempts: Optional[int]; loaded_attempts: Optional[int]
    unloaded_samples: Optional[int]; loaded_samples: Optional[int]
    unloaded_timeouts: Optional[int]; loaded_timeouts: Optional[int]
    unloaded_rtt_ms: Optional[float]; loaded_rtt_ms: Optional[float]
    raw_unloaded_ms: list; raw_loaded_ms: list; check: str = "congestion"

@dataclass
class MeasurementSet:
    id: str; label: str; source: str; captured_at: str
    gateway: GatewayMeasurement; dns: DnsMeasurement
    packet_loss: PacketLossMeasurement; congestion: CongestionMeasurement

def blank_gateway(at, src, reason):
    return GatewayMeasurement(at, src, "not measured", reason, None, None, None, None, [])
def blank_dns(at, src, reason):
    return DnsMeasurement(at, src, "not measured", reason, None, None, None, None, None, [], None)
def blank_loss(at, src, reason):
    return PacketLossMeasurement(at, src, "not measured", reason, None, None, None, None, [])
def blank_congestion(at, src, reason):
    return CongestionMeasurement(at, src, "not measured", reason, None, None, None, None, None, None, None, None, None, [], [])

def to_wire(obj: Any) -> Any:
    if is_dataclass(obj) and not isinstance(obj, type):
        return {camel(f.name): to_wire(getattr(obj, f.name)) for f in fields(obj)}
    if isinstance(obj, (list, tuple)): return [to_wire(x) for x in obj]
    if isinstance(obj, dict): return {k: to_wire(v) for k, v in obj.items()}
    return obj

def _build(cls, data, name):
    if not isinstance(data, dict): raise ValueError(f"{name} must be an object")
    kwargs = {}
    for f in fields(cls):
        key = camel(f.name)
        if key not in data: raise ValueError(f"{name}.{key} is missing")
        kwargs[f.name] = data[key]
    if kwargs["check"] != cls.__dataclass_fields__["check"].default:
        raise ValueError(f"{name}.check is wrong")
    return cls(**kwargs)

def measurement_from_wire(data: Any) -> MeasurementSet:
    if not isinstance(data, dict): raise ValueError("measurement must be an object")
    for key in ("id", "label", "capturedAt"):
        if not isinstance(data.get(key), str): raise ValueError(f"{key} must be a string")
    if data.get("source") not in SOURCES: raise ValueError("source must be lab, local_agent or browser")
    return MeasurementSet(
        data["id"], data["label"], data["source"], data["capturedAt"],
        _build(GatewayMeasurement, data.get("gateway"), "gateway"),
        _build(DnsMeasurement, data.get("dns"), "dns"),
        _build(PacketLossMeasurement, data.get("packetLoss"), "packetLoss"),
        _build(CongestionMeasurement, data.get("congestion"), "congestion"),
    )
