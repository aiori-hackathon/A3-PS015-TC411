"""Local FastAPI agent. Binds 127.0.0.1:8765 only. Protocol-compatible with the ProbeSpeak console."""
import os
from typing import Optional
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from . import __version__
from .actions import ActionHandler
from .engine.diagnose import diagnose
from .models import measurement_from_wire, to_wire
from .probes import ping
from .scenarios import SCENARIOS, run_scenario, scenario_by_id
from .thresholds import AGENT_HOST, AGENT_PORT, ALLOWED_ACTIONS, THRESHOLDS

DEFAULT_ORIGINS = (
    "http://localhost:8080", "http://127.0.0.1:8080",
    "http://localhost:5173", "http://127.0.0.1:5173",
    "https://probespeak.vercel.app",
)

def allowed_origins():
    extra = [o.strip() for o in os.environ.get("PROBESPEAK_ORIGINS", "").split(",") if o.strip()]
    return set(DEFAULT_ORIGINS) | set(extra)

def create_app(handler=None, origins=None, port=AGENT_PORT):
    handler = handler or ActionHandler()
    origins = origins if origins is not None else allowed_origins()
    app = FastAPI(title="ProbeSpeak local agent", version=__version__,
                  docs_url=None, redoc_url=None, openapi_url=None)
    hosts = {f"127.0.0.1:{port}", f"localhost:{port}", "127.0.0.1", "localhost", "testserver"}

    @app.middleware("http")
    async def guard(request: Request, call_next):
        host = (request.headers.get("host") or "").lower()
        if host not in hosts:
            return JSONResponse({"ok": False, "error": "Host header is not loopback."}, status_code=403)
        origin = request.headers.get("origin")
        if origin and origin not in origins:
            return JSONResponse({"ok": False, "error": "Origin not allowed."}, status_code=403)
        resp = Response(status_code=204) if request.method == "OPTIONS" else await call_next(request)
        if origin:
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Access-Control-Allow-Private-Network"] = "true"
            resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Accept"
            resp.headers["Vary"] = "Origin"
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.get("/health")
    def health():
        return {"ok": True, "ready": True, "name": "probespeak-agent", "version": __version__,
                "bind": f"{AGENT_HOST}:{port}", "actions": list(ALLOWED_ACTIONS),
                "mode": "changes_allowed" if handler.allow_changes else "read_only",
                "platform": ping.system_name()}

    @app.post("/action")
    async def action(request: Request):
        try: body = await request.json()
        except Exception:
            return JSONResponse({"ok": False, "error": "Body is not JSON."}, status_code=400)
        name = body.get("action") if isinstance(body, dict) else None
        if name not in ALLOWED_ACTIONS:
            return JSONResponse({"ok": False, "action": name, "error": "Action not allowlisted."}, status_code=400)
        from starlette.concurrency import run_in_threadpool
        return await run_in_threadpool(handler.handle, name)

    @app.post("/diagnose")
    async def diagnose_endpoint(request: Request):
        try: m = measurement_from_wire(await request.json())
        except (ValueError, TypeError) as e:
            return JSONResponse({"ok": False, "error": f"Not a complete measurement document: {e}"}, status_code=422)
        return {"ok": True, "diagnosis": diagnose(m)}

    @app.get("/thresholds")
    def thresholds(): return THRESHOLDS

    @app.get("/scenarios")
    def scenarios():
        return [{"id": s.id, "title": s.title, "situation": s.situation,
                 "faultClass": s.fault_class, "hasRetest": s.retest is not None}
                for s in SCENARIOS]

    @app.get("/lab/run/{scenario_id}")
    def lab_run(scenario_id: str):
        sc = scenario_by_id(scenario_id)
        if sc is None:
            return JSONResponse({"ok": False, "error": "Unknown scenario."}, status_code=404)
        return run_scenario(sc)

    @app.exception_handler(404)
    async def not_found(_, __):
        return JSONResponse({"ok": False, "error": "Not found."}, status_code=404)

    return app
