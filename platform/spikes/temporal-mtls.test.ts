import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Server,
  ServerCredentials,
  type MethodDefinition,
  type ServiceDefinition,
  type handleUnaryCall
} from '@grpc/grpc-js';
import { NativeConnection } from '@temporalio/worker';

let directory = '';
let server: Server;
let address = '';
let ca = Buffer.alloc(0);
let clientCrt = Buffer.alloc(0);
let clientKey = Buffer.alloc(0);
let authenticatedCalls = 0;

const openssl = (...args: string[]): void => {
  execFileSync('openssl', args, { cwd: directory, stdio: 'ignore' });
};

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sage-temporal-mtls-'));
  await writeFile(join(directory, 'server.ext'), 'subjectAltName=DNS:temporal.test\nextendedKeyUsage=serverAuth\n');
  await writeFile(join(directory, 'client.ext'), 'extendedKeyUsage=clientAuth\n');
  openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-subj', '/CN=Sage Test CA', '-days', '1');
  openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=temporal.test');
  openssl('x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.crt', '-days', '1', '-extfile', 'server.ext');
  openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'client.key', '-out', 'client.csr', '-subj', '/CN=sage-worker');
  openssl('x509', '-req', '-in', 'client.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'client.crt', '-days', '1', '-extfile', 'client.ext');

  ca = await readFile(join(directory, 'ca.crt'));
  clientCrt = await readFile(join(directory, 'client.crt'));
  clientKey = await readFile(join(directory, 'client.key'));
  const serverCrt = await readFile(join(directory, 'server.crt'));
  const serverKey = await readFile(join(directory, 'server.key'));

  const getSystemInfo: MethodDefinition<Buffer, Buffer> = {
    path: '/temporal.api.workflowservice.v1.WorkflowService/GetSystemInfo',
    requestStream: false,
    responseStream: false,
    requestSerialize: (value) => value,
    requestDeserialize: (value) => value,
    responseSerialize: (value) => value,
    responseDeserialize: (value) => value
  };
  const service: ServiceDefinition = { getSystemInfo };
  const handler: handleUnaryCall<Buffer, Buffer> = (_call, callback) => {
    authenticatedCalls += 1;
    callback(null, Buffer.alloc(0));
  };
  server = new Server();
  server.addService(service, { getSystemInfo: handler });
  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync(
      '127.0.0.1:0',
      ServerCredentials.createSsl(ca, [{ private_key: serverKey, cert_chain: serverCrt }], true),
      (error, boundPort) => error ? reject(error) : resolve(boundPort)
    );
  });
  address = `127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});

describe('Temporal SDK mTLS behavior', () => {
  it('connects with trusted CA, SNI override, and a client certificate', async () => {
    const connection = await NativeConnection.connect({
      address,
      tls: {
        serverNameOverride: 'temporal.test',
        serverRootCACertificate: ca,
        clientCertPair: { crt: clientCrt, key: clientKey }
      }
    });
    await connection.close();
    expect(authenticatedCalls).toBeGreaterThan(0);
  });

  it('rejects a client that omits its certificate', async () => {
    await expect(NativeConnection.connect({
      address,
      tls: { serverNameOverride: 'temporal.test', serverRootCACertificate: ca }
    })).rejects.toThrow();
  }, 15_000);
});
