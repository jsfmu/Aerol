import argparse
from socketserver import ThreadingMixIn
from wsgiref.simple_server import WSGIServer, make_server
from .server import application

class Server(ThreadingMixIn, WSGIServer):
    daemon_threads = True

def main():
    parser = argparse.ArgumentParser(description='Run the AEROL research dashboard')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    with make_server(args.host, args.port, application, server_class=Server) as server:
        print(f'AEROL desktop: http://{args.host}:{args.port}/', flush=True)
        print(f'AEROL mobile:  http://{args.host}:{args.port}/mobile/', flush=True)
        server.serve_forever()

if __name__ == '__main__':
    main()
