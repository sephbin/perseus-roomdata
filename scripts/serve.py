"""Dev server for the public/ folder, with caching turned off.

python -m http.server answers conditional requests, so a browser will happily
keep running a module you have just edited -- which looks like the app being
broken rather than stale. This serves the same files with no-store, so a plain
reload always picks up the latest.

    python scripts/serve.py            # http://127.0.0.1:5173
    python scripts/serve.py 8080
"""
import functools
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()

    def send_header(self, keyword, value):
        if keyword.lower() in ('last-modified', 'etag'):
            return                      # nothing to revalidate against
        super().send_header(keyword, value)


if __name__ == '__main__':
    handler = functools.partial(NoCache, directory=ROOT)
    with http.server.ThreadingHTTPServer(('127.0.0.1', PORT), handler) as httpd:
        print(f'serving {os.path.normpath(ROOT)} at http://127.0.0.1:{PORT}  (no caching)')
        httpd.serve_forever()
