export class Metrics {
  clients = 0; rpcRequests = 0; rpcErrors = 0; reconnects = 0; replays = 0; resyncs = 0; notifications = 0;
  render(): string { return Object.entries({ codex_control_connected_clients: this.clients, codex_control_rpc_requests_total: this.rpcRequests, codex_control_rpc_errors_total: this.rpcErrors, codex_control_websocket_reconnects_total: this.reconnects, codex_control_replays_total: this.replays, codex_control_resyncs_total: this.resyncs, codex_control_notifications_total: this.notifications }).map(([name, value]) => `# TYPE ${name} gauge\n${name} ${value}`).join("\n") + "\n"; }
}
