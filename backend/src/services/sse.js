// Server-Sent Events hub: pushes live updates to dashboards.
export function createHub() {
  const clients = new Set()
  let seq = 0

  const write = (res, event, data) => {
    res.write(`id: ${++seq}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(': ping\n\n')
  }, 25000)
  heartbeat.unref()

  return {
    add(res) {
      clients.add(res)
      res.on('close', () => clients.delete(res))
    },
    send(res, event, data) { write(res, event, data) },
    broadcast(event, data) { for (const c of clients) write(c, event, data) },
    get size() { return clients.size },
    closeAll() { clearInterval(heartbeat); for (const c of clients) c.end(); clients.clear() }
  }
}
