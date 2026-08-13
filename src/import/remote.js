// Fetching a script from a link.
//
// The hard part is not the fetch, it is explaining the failure. A browser
// cannot read a URL whose server does not send permission to (CORS), and when
// that happens fetch rejects with a generic network error carrying no reason at
// all — indistinguishable from a typo or an outage. So the failures below are
// named, and the UI says which one it is rather than "could not load".

const MAX_BYTES = 2 * 1024 * 1024; // a script is text; anything larger is not one

export class RemoteScriptError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

/**
 * Turn a link someone actually has into one a browser can read.
 *
 * A GitHub file URL is a web page, not the file — pasting the address bar is
 * the obvious thing to do and would otherwise fetch HTML and parse it as a
 * script.
 */
export function normaliseUrl(input) {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) throw new RemoteScriptError('empty', 'Enter a link first.');

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new RemoteScriptError('invalid', 'That does not look like a link.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new RemoteScriptError('invalid', 'Only web links can be loaded.');
  }

  // github.com/owner/repo/blob/branch/path -> the raw file
  const blob = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (url.hostname === 'github.com' && blob) {
    return new URL(`https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`);
  }

  // gist.github.com/owner/id -> the raw gist
  const gist = url.pathname.match(/^\/([^/]+)\/([0-9a-f]+)\/?$/i);
  if (url.hostname === 'gist.github.com' && gist) {
    return new URL(`https://gist.githubusercontent.com/${gist[1]}/${gist[2]}/raw`);
  }

  return url;
}

/** A share page rather than the file itself. */
export function looksLikeMarkup(text) {
  const head = text.slice(0, 400).trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<?xml');
}

/** Bytes that are not text at all — a PDF, a Word file, an image. */
export function looksBinary(text) {
  // A control character that is not tab, newline or carriage return.
  return /[\0-\x08\x0e-\x1f]/.test(text.slice(0, 2000));
}

export const filenameFrom = (url) => decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '');

/**
 * @returns {Promise<{ text: string, filename: string, url: string }>}
 * @throws  {RemoteScriptError} with a `reason` the UI can explain
 */
export async function fetchScript(input, { signal, fetchImpl = fetch } = {}) {
  const url = normaliseUrl(input);

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new RemoteScriptError('offline', 'You are offline, so the link cannot be fetched.');
  }

  let response;
  try {
    response = await fetchImpl(url.href, { signal, redirect: 'follow' });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    // Both a CORS refusal and an unreachable host land here, and the browser
    // deliberately does not say which.
    throw new RemoteScriptError(
      'blocked',
      'The browser was not allowed to read that link. Many sites do not permit it; a raw file link usually works.',
    );
  }

  if (!response.ok) {
    throw new RemoteScriptError(
      response.status === 404 ? 'not-found' : 'http-error',
      `The link returned ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`,
    );
  }

  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_BYTES) {
    throw new RemoteScriptError('too-large', 'That file is too large to be a script.');
  }

  const text = await response.text();
  if (text.length > MAX_BYTES) {
    throw new RemoteScriptError('too-large', 'That file is too large to be a script.');
  }
  if (!text.trim()) throw new RemoteScriptError('empty-file', 'That link returned nothing.');
  if (looksBinary(text)) {
    throw new RemoteScriptError(
      'not-text',
      'That link is a document, not plain text. Export it as .txt or .fountain first.',
    );
  }
  if (looksLikeMarkup(text)) {
    throw new RemoteScriptError(
      'markup',
      'That link is a web page rather than the file itself. Look for a "raw" or "download" link.',
    );
  }

  return { text, filename: filenameFrom(url), url: url.href };
}
