import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Recorded {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: string;
}

/**
 * A local stand-in for the operators' HTTPS APIs, answering in their documented
 * formats, so the real drivers can be exercised end to end in tests.
 * A message containing "FAIL5XX" gets a 503; "FAIL4XX" gets a 400.
 */
export async function startFakeGateway() {
  const calls: Recorded[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const path = req.url ?? '';
      calls.push({ method: req.method ?? '', path, headers: req.headers, body });
      const json = (status: number, v: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(v));
      };
      if (body.includes('FAIL5XX')) return json(503, { error: 'unavailable' });
      if (body.includes('FAIL4XX')) return json(400, { requestError: { serviceException: { messageId: 'SVC0002', text: 'Invalid input' } } });
      if (path === '/oauth/v3/token') return json(200, { token_type: 'Bearer', access_token: 'orange-token', expires_in: 3600 });
      if (path.startsWith('/smsmessaging/v1/outbound/')) {
        return json(201, { outboundSMSMessageRequest: { resourceURL: `http://x/smsmessaging/v1/outbound/tel:+2370000/requests/or-123` } });
      }
      if (path.startsWith('/mtn/token')) return json(200, { access_token: 'mtn-token', expires_in: 3600 });
      if (path === '/mtn/send') return json(201, { transactionId: 'mtn-456', statusCode: '0000' });
      if (/^\/v\d+\.\d+\/\d+\/messages$/.test(path)) return json(200, { messaging_product: 'whatsapp', messages: [{ id: 'wamid.789' }] });
      if (path.startsWith('/agg')) return json(200, { id: 'agg-1' });
      return json(404, { error: 'not found' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, calls, close: () => new Promise<void>((r) => server.close(() => r())) };
}
