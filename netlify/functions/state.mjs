import { getStore } from '@netlify/blobs';

export default async (req) => {
  const store = getStore('sgt-retro');
  const url = new URL(req.url);
  const room = (url.searchParams.get('room') || 'default')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 40) || 'default';
  const key = 'board-' + room;

  if (req.method === 'GET') {
    const val = await store.get(key);
    return new Response(val || 'null', {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
    });
  }

  if (req.method === 'POST') {
    const body = await req.text();
    if (body.length > 300000) {
      return new Response('{"error":"board too large"}', { status: 413 });
    }
    try {
      JSON.parse(body); // validate it's JSON before storing
    } catch {
      return new Response('{"error":"invalid JSON"}', { status: 400 });
    }
    await store.set(key, body);
    return new Response('{"ok":true}', {
      headers: { 'content-type': 'application/json' }
    });
  }

  return new Response('{"error":"method not allowed"}', { status: 405 });
};

export const config = { path: '/api/state' };
