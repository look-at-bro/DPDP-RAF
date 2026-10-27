export const SESSION_EXPIRED_EVENT = 'dpdp:session-expired';

export async function apiFetch(input, options) {
  const response = await fetch(input, options);
  if (response.status === 401) {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
  return response;
}