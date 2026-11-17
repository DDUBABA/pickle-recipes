export class ApiError extends Error {
  constructor(status, code, message, extra = {}) { super(message); Object.assign(this, {status, code, extra}); }
}
export const fail = (status, code, message, extra) => { throw new ApiError(status, code, message, extra); };
export const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
}});
export async function body(request, max = 512 * 1024) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) fail(415, 'JSON_REQUIRED', 'application/json 요청이 필요합니다.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'INVALID_JSON', 'JSON 본문이 필요합니다.');
  let size = 0; const chunks = [];
  while (true) {
    const {done, value} = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); fail(413, 'BODY_TOO_LARGE', '요청 크기가 제한을 초과했습니다.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); } catch { fail(400, 'INVALID_JSON', '올바른 JSON이 아닙니다.'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') fail(400, 'INVALID_JSON', 'JSON 객체가 필요합니다.');
  return value;
}
export function textField(value, label, max = 100, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/u.test(value)) fail(400, 'INVALID_FIELD', `${label} 형식을 확인해 주세요.`);
  return value.trim();
}
export function clientType(value = 'pickle') {
  if (!['pickle','web'].includes(value)) fail(400, 'INVALID_CLIENT', 'clientType은 pickle 또는 web이어야 합니다.');
  return value;
}
export async function sha256(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function constantEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let result = 0; for (let i=0;i<a.length;i++) result |= a.charCodeAt(i)^b.charCodeAt(i); return result === 0;
}
export const bearer = request => request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1] ?? '';
export const requestInfo = request => ({ip: request.headers.get('CF-Connecting-IP') || null, agent: request.headers.get('User-Agent')?.slice(0,1000) || null});
