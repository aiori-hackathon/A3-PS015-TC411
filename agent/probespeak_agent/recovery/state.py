import json, os
from pathlib import Path

class SnapshotStore:
    def __init__(self, directory=None):
        base = directory or Path(os.environ.get("PROBESPEAK_STATE_DIR", str(Path.home() / ".probespeak")))
        self.path = Path(base) / "dns_snapshot.json"

    def load(self):
        try: return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError): return None

    def save(self, snapshot):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        with open(tmp, "w") as fh:
            json.dump(snapshot, fh); fh.flush(); os.fsync(fh.fileno())
        os.replace(tmp, self.path)

    def clear(self):
        try: self.path.unlink()
        except OSError: pass
