// Minimal forward proxy (CONNECT tunnels and absolute-form requests) standing in for Fixie,
// to test the backend's Moneta lanes. Counts tunnels. Usage: node fwd-proxy.mjs <port>
import http from "node:http";
import net from "node:net";
const port = Number(process.argv[2] ?? 4596);
let tunnels = 0;
const server = http.createServer((req, res) => {
  if (req.url === "/__stats") return res.end(JSON.stringify({ tunnels }));
  const u = new URL(req.url);
  const up = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on("error", () => res.destroy());
  req.pipe(up);
});
server.on("connect", (req, client, head) => {
  tunnels++;
  const [host, p] = req.url.split(":");
  const up = net.connect(Number(p), host === "localhost" ? "127.0.0.1" : host, () => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head?.length) up.write(head);
    up.pipe(client);
    client.pipe(up);
  });
  const close = () => { client.destroy(); up.destroy(); };
  up.on("error", close);
  client.on("error", close);
});
server.listen(port, () => console.log(`forward proxy on ${port}`));
