"""URL 安全判断（SSRF 防护），独立 leaf 模块。

从 gateway_service 抽出，供 gateway / diagnostics 等多处复用，
避免模块顶层 import 触发 ``gateway_service ↔ model_service`` 的循环导入。
仅依赖标准库，不 import 任何 app.* 服务。
"""
import ipaddress
import re
from urllib.parse import urlparse


def is_private_url(url: str) -> bool:
    """True for localhost / private-LAN / metadata URLs that must not be fetched (SSRF guard).

    Covers private IPv4/IPv6 ranges, loopback, link-local (incl. cloud metadata
    169.254.169.254), and integer / hex IP variants via :mod:`ipaddress`.
    """
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return True
    if not host:
        return True

    # Hostname-level blocklist (also catches trailing-dot forms).
    if host.rstrip(".") in ("localhost",) or host.endswith(".local") or host.endswith(".localhost"):
        return True

    # IP-level: normalize decimal / hex / octal / IPv6 forms through ipaddress.
    candidate = host
    try:
        if host.isdigit():  # integer IPv4 form, e.g. 2130706433 == 127.0.0.1
            candidate = str(ipaddress.ip_address(int(host)))
        elif host.startswith(("0x", "0X")):  # hex IPv4 form, e.g. 0x7f000001 == 127.0.0.1
            candidate = str(ipaddress.ip_address(int(host, 0)))
    except (ValueError, OverflowError):
        candidate = host
    try:
        ip = ipaddress.ip_address(candidate)
        return (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_unspecified
            or ip.is_multicast
        )
    except ValueError:
        pass

    # Regex fallback for non-IP host strings.
    if re.match(r"^(127\.|10\.|192\.168\.|169\.254\.)", host) or re.match(r"^172\.(1[6-9]|2\d|3[01])\.", host):
        return True
    if re.match(r"^0+\.0+\.0+\.0+$", host):  # 0.0.0.0
        return True
    return False
