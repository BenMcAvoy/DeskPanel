from functools import partial
from http.client import HTTPConnection, HTTPSConnection
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
import os
from urllib.parse import urlsplit


DIST_DIR = Path(__file__).resolve().parent / "dist"
HOST = os.environ.get("FRONTEND_HOST", "0.0.0.0")
PORT = int(os.environ.get("FRONTEND_PORT", "4173"))
HOME_ASSISTANT_URL = os.environ.get("VITE_HOME_ASSISTANT_URL", "").strip().rstrip("/")
HOME_ASSISTANT_PROXY_BASE = "/__ha"
FORWARDED_REQUEST_HEADERS = {
    "authorization",
    "content-type",
    "accept",
    "cache-control",
    "pragma",
    "user-agent",
}
RESPONSE_HEADER_BLACKLIST = {
    "connection",
    "content-encoding",
    "content-length",
    "date",
    "keep-alive",
    "server",
    "transfer-encoding",
}


class SpaRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory: str | None = None, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _resolve_home_assistant_url(self) -> str:
        forwarded = self.headers.get("X-Home-Assistant-Url", "").strip().rstrip("/")
        return HOME_ASSISTANT_URL or forwarded

    def _proxy_home_assistant(self) -> None:
        upstream_base = self._resolve_home_assistant_url()
        if not upstream_base:
            self.send_error(HTTPStatus.BAD_GATEWAY, "Home Assistant proxy is not configured")
            return

        target = urlsplit(f"{upstream_base}{self.path[len(HOME_ASSISTANT_PROXY_BASE):]}")
        if target.scheme not in {"http", "https"} or not target.netloc:
            self.send_error(HTTPStatus.BAD_GATEWAY, "Invalid Home Assistant URL")
            return

        connection_cls = HTTPSConnection if target.scheme == "https" else HTTPConnection
        connection = connection_cls(target.netloc, timeout=15)
        body = None
        content_length = self.headers.get("Content-Length")
        if content_length:
            body = self.rfile.read(int(content_length))

        forwarded_headers = {
            key: value
            for key, value in self.headers.items()
            if key.lower() in FORWARDED_REQUEST_HEADERS
        }
        forwarded_headers["Host"] = target.netloc

        try:
            path = target.path or "/"
            if target.query:
                path = f"{path}?{target.query}"
            connection.request(self.command, path, body=body, headers=forwarded_headers)
            response = connection.getresponse()
            payload = response.read()
        except Exception as exc:
            self.send_error(HTTPStatus.BAD_GATEWAY, f"Home Assistant proxy error: {exc}")
            return
        finally:
            connection.close()

        self.send_response(response.status)
        for key, value in response.getheaders():
            if key.lower() in RESPONSE_HEADER_BLACKLIST:
                continue
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self) -> None:
        if self.path.startswith(HOME_ASSISTANT_PROXY_BASE):
            self._proxy_home_assistant()
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def do_GET(self) -> None:
        if self.path.startswith(HOME_ASSISTANT_PROXY_BASE):
            self._proxy_home_assistant()
            return

        requested = self.translate_path(self.path)
        path = Path(requested)

        if self.path.startswith("/@") or self.path.startswith("/__vite"):
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        if path.exists() or self.path in {"/", ""}:
            super().do_GET()
            return

        self.path = "/index.html"
        super().do_GET()


def main() -> None:
    handler = partial(SpaRequestHandler, directory=str(DIST_DIR))
    server = ThreadingHTTPServer((HOST, PORT), handler)
    print(f"Serving control_frontend dist on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()