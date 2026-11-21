#!/usr/bin/env node
import dns from 'node:dns';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  // Ignore on runtimes that do not support setDefaultResultOrder
}

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const { startServer } = await import('../server.js');
await startServer();
