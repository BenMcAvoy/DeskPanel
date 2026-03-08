from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os


DIST_DIR = Path(__file__).resolve().parent / "dist"
HOST = os.environ.get("FRONTEND_HOST", "0.0.0.0")
PORT = int(os.environ.get("FRONTEND_PORT", "4173"))


class SpaRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory: str | None = None, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self) -> None:
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