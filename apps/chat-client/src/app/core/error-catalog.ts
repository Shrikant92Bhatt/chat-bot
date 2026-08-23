export interface UserFriendlyError {
  code: string;
  refId: string;
  title: string;
  message: string;
  suggestion: string;
}

export function formatUserFriendlyError(status: number, rawMessage?: string): UserFriendlyError {
  const refId = `REF-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  switch (status) {
    case 400:
      return {
        code: 'ERR_BAD_REQUEST',
        refId,
        title: 'Sign-in Failed',
        message: 'The sign-in request could not be processed. Please try again.',
        suggestion: 'If the problem persists, please refresh the page.',
      };
    case 401:
      return {
        code: 'ERR_UNAUTHORIZED',
        refId,
        title: 'Authentication Required',
        message: 'Your Google sign-in session could not be verified.',
        suggestion: 'Please sign in again with your Google account.',
      };
    case 403:
      return {
        code: 'ERR_ACCESS_DENIED',
        refId,
        title: 'Access Restricted',
        message: 'Your account does not have permission to access this resource.',
        suggestion: 'Please contact your administrator if you believe this is an error.',
      };
    case 404:
      return {
        code: 'ERR_NOT_FOUND',
        refId,
        title: 'Service Temporarily Unavailable',
        message: 'The authentication service could not be reached.',
        suggestion: 'Please try again in a few moments.',
      };
    case 405:
      return {
        code: 'ERR_SIGNIN_UNAVAILABLE',
        refId,
        title: 'Sign-in Service Update',
        message: 'The sign-in service is currently being updated or temporarily unavailable.',
        suggestion: 'Please refresh the page and try signing in again.',
      };
    case 429:
      return {
        code: 'ERR_TOO_MANY_REQUESTS',
        refId,
        title: 'Too Many Attempts',
        message: 'Multiple sign-in attempts were detected.',
        suggestion: 'Please wait a minute before trying again.',
      };
    case 500:
    case 502:
    case 503:
    case 504:
    default:
      return {
        code: 'ERR_SERVER_ISSUE',
        refId,
        title: 'Sign-in Temporarily Unavailable',
        message: rawMessage || 'We encountered a temporary problem while signing you in.',
        suggestion: 'Please try again in a few moments.',
      };
  }
}
