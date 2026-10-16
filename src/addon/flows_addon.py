# The cli-flows addon for mitmproxy: each finished flow (or failed one) as one JSON line to the recorder's local socket, named by
# FLOWS_SOCKET. Redaction happens in the recorder, before anything touches the disk; this sends, it never writes a file.
import json
import os
import socket

BODY_LIMIT = 1024 * 1024
_connection = None


def _send(record):
    global _connection
    if _connection is None:
        _connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        _connection.connect(os.environ["FLOWS_SOCKET"])
    _connection.sendall((json.dumps(record) + "\n").encode("utf-8"))


def _message(message):
    if message is None:
        return None
    raw = message.raw_content or b""
    body = message.get_text(strict=False) if raw else None
    return {
        "headers": [[name, value] for name, value in message.headers.items(multi=True)],
        "size": len(raw),
        "body": body[:BODY_LIMIT] if body else None,
    }


def _record(flow):
    request, response = flow.request, flow.response
    end = (response and response.timestamp_end) or request.timestamp_end or request.timestamp_start
    return {
        "start": request.timestamp_start,
        "end": end,
        "method": request.method,
        "scheme": request.scheme,
        "host": request.pretty_host,
        "port": request.port,
        "path": request.path,
        "status": response.status_code if response else None,
        "error": flow.error.msg if flow.error else None,
        "request": _message(request),
        "response": _message(response),
    }


def response(flow):
    _send(_record(flow))


def error(flow):
    _send(_record(flow))
