export interface UserFriendlyError {
  code: string;
  refId: string;
  title: string;
  message: string;
  suggestion: string;
}

export function formatUserFriendlyError(status: number, rawMessage?: string): UserFriendlyError {
  const refId = `ERR-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  switch (status) {
    case 400:
      return {
        code: 'ERR_BAD_REQUEST',
        refId,
        title: 'Invalid Request',
        message: rawMessage || 'The request sent to the authentication service was malformed.',
        suggestion: 'Please refresh the page and try signing in again.',
      };
    case 401:
      return {
        code: 'ERR_UNAUTHORIZED',
        refId,
        title: 'Authentication Required',
        message: 'Your Google sign-in session could not be verified by the server.',
        suggestion: 'Please select your Google account and sign in again.',
      };
    case 403:
      return {
        code: 'ERR_ACCESS_DENIED',
        refId,
        title: 'Access Restricted',
        message: rawMessage || 'Sign-in was rejected by server authorization policies.',
        suggestion: 'Ensure your account has proper permissions or contact support.',
      };
    case 404:
      return {
        code: 'ERR_ROUTE_NOT_FOUND',
        refId,
        title: 'Service Endpoint Unavailable',
        message: 'The authentication service endpoint was not found on the server.',
        suggestion: 'Verify backend API service routing and container health.',
      };
    case 405:
      return {
        code: 'ERR_METHOD_NOT_ALLOWED',
        refId,
        title: 'HTTP Method Discrepancy',
        message: 'The authentication request used an invalid HTTP method for this endpoint.',
        suggestion: 'Ensure POST request headers and route handlers match server API specifications.',
      };
    case 429:
      return {
        code: 'ERR_TOO_MANY_REQUESTS',
        refId,
        title: 'Rate Limit Reached',
        message: 'Too many sign-in attempts were made in a short period.',
        suggestion: 'Please wait a minute before trying to sign in again.',
      };
    case 500:
    case 502:
    case 503:
    case 504:
      return {
        code: 'ERR_SERVER_TEMPORARY_ISSUE',
        refId,
        title: 'Server Temporarily Unavailable',
        message: 'The backend service encountered a temporary glitch while establishing your session.',
        suggestion: 'Our system has logged this incident. Please try again in a few moments.',
      };
    default:
      return {
        code: `ERR_HTTP_${status}`,
        refId,
        title: 'Authentication Notice',
        message: rawMessage || 'An unexpected response was received during sign-in.',
        suggestion: 'Please verify your network connection and try again.',
      };
  }
}
