from probespeak_agent.recovery.dns_backends import MacNetworksetupBackend
from probespeak_agent.runner import CmdResult

class _R:
    def __init__(self, text): self.text = text
    def run(self, argv, timeout=10):
        return CmdResult(list(argv), 0, self.text, "")

def test_mac_reads_one_resolver():
    state = MacNetworksetupBackend(_R("192.0.2.1\n"), service="Wi-Fi").read()
    assert state.target == "Wi-Fi"
    assert state.servers == ["192.0.2.1"]
    assert state.dhcp_supplied is False

def test_mac_empty_means_automatic():
    state = MacNetworksetupBackend(
        _R("There aren't any DNS Servers set on Wi-Fi.\n"), service="Wi-Fi").read()
    assert state.servers == []
    assert state.dhcp_supplied is True
