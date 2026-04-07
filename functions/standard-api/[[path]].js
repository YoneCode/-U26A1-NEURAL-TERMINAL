/**
 * Cloudflare Pages Function — proxy /standard-api/* → explorer-api.testnet-chain.genlayer.com
 * Replaces the broken _redirects external proxy (Pages does not support external
 * origins via _redirects status 200). This runs server-side on Cloudflare's edge,
 * so there are no CORS restrictions.
 */
export async function onRequest({ request, params }) {
  const path   = params.path ? '/' + params.path.join('/') : '';
  const url    = new URL(request.url);
  const target = `https://explorer-api.testnet-chain.genlayer.com${path}${url.search}`;

  const res  = await fetch(target, {
    method:  request.method,
    headers: { Accept: 'application/json' },
  });

  const body = await res.arrayBuffer();
  return new Response(body, {
    status: res.status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
