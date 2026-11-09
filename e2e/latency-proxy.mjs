// TCP proxy that adds a one-way delay to every packet, to make the local database behave
// like the live one (Render → Supabase ≈ 65 ms round trip). Usage: node latency-proxy.mjs <listen> <target> <oneWayMs>
import net from "node:net";
const [listen = "5434", target = "5433", ms = "33"] = process.argv.slice(2);
const delay = Number(ms);
net
  .createServer((client) => {
    const server = net.connect(Number(target), "127.0.0.1");
    const pipe = (from, to) => from.on("data", (chunk) => setTimeout(() => to.writable && to.write(chunk), delay));
    pipe(client, server);
    pipe(server, client);
    const close = () => { client.destroy(); server.destroy(); };
    client.on("error", close).on("close", close);
    server.on("error", close).on("close", close);
  })
  .listen(Number(listen), () => console.log(`latency proxy ${listen} -> ${target} (+${delay} ms each way)`));
