import os, shutil, subprocess, sys
from dataclasses import dataclass
from typing import Sequence

ALLOWED = {"ping","ip","route","powershell","ipconfig","netsh",
           "resolvectl","nmcli","networkctl","networksetup"}

class RunnerError(Exception): pass

@dataclass
class CmdResult:
    argv: list; returncode: int; stdout: str; stderr: str; timed_out: bool = False
    @property
    def text(self): return (self.stdout or "") + ("\n" + self.stderr if self.stderr else "")

class Runner:
    def run(self, argv: Sequence[str], timeout: float = 10.0) -> CmdResult:
        exe = os.path.basename(argv[0]).lower()
        if exe.endswith(".exe"): exe = exe[:-4]
        if exe not in ALLOWED:
            raise RunnerError(f"Refused: {argv[0]!r} is not allowlisted.")
        path = shutil.which(argv[0])
        if path is None:
            raise RunnerError(f"{argv[0]} is not installed or not on PATH.")
        kw = {}
        if sys.platform == "win32": kw["creationflags"] = 0x08000000
        try:
            p = subprocess.run([path, *argv[1:]], capture_output=True, text=True,
                               timeout=timeout, shell=False, errors="replace", **kw)
            return CmdResult(list(argv), p.returncode, p.stdout, p.stderr)
        except subprocess.TimeoutExpired as e:
            return CmdResult(list(argv), -1, (e.stdout or "") if isinstance(e.stdout, str) else "", "", True)
