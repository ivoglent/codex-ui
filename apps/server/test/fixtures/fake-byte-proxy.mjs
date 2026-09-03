import { connect } from "node:net";

const socket = connect(Number(process.argv[2]), "127.0.0.1");
process.stdin.pipe(socket);
socket.pipe(process.stdout);
socket.on("error", (error) => { process.stderr.write(error.message); process.exit(1); });
