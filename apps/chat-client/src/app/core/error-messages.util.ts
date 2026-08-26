/**
 * Converts raw error messages/status codes into friendly, user-facing messages.
 * Extracts the actual error detail from technical error text.
 */
export function getFriendlyErrorMessage(error: any, context: 'upload' | 'chat' | 'general' = 'general'): string {
  if (!error) return getDefaultMessage(context);

  const message = error.message || String(error);

  // If it's a network/abort error
  if (error.name === 'AbortError' || message.includes('aborted')) {
    return 'Request was cancelled.';
  }

  // Try to extract a friendly message from HTTP error responses
  if (message.includes('HTTP')) {
    const statusMatch = message.match(/HTTP (\d+)/);
    if (statusMatch) {
      const status = parseInt(statusMatch[1], 10);
      return getHttpErrorMessage(status);
    }
  }

  // If the error message looks like a server-generated error (not raw stack trace)
  // and it's already somewhat friendly, use it
  if (message && !message.includes('at ') && !message.includes('TypeError') && !message.includes('ReferenceError')) {
    // But cap it to avoid long/overly technical messages
    if (message.length < 100) {
      return message;
    }
  }

  return getDefaultMessage(context);
}

function getHttpErrorMessage(status: number): string {
  switch (status) {
    case 400:
      return 'Invalid request. Please try again with different input.';
    case 401:
    case 403:
      return 'You do not have permission to do this. Please sign in.';
    case 404:
      return 'The resource was not found.';
    case 429:
      return 'Too many requests. Please wait a moment and try again.';
    case 500:
    case 502:
    case 503:
      return 'The service is experiencing issues. Please try again in a moment.';
    case 504:
      return 'The request took too long. Please try again.';
    default:
      if (status >= 400 && status < 500) {
        return 'The request could not be completed. Please check your input.';
      }
      if (status >= 500) {
        return 'A server error occurred. Please try again later.';
      }
      return 'Something went wrong. Please try again.';
  }
}

function getDefaultMessage(context: 'upload' | 'chat' | 'general'): string {
  switch (context) {
    case 'upload':
      return 'Upload failed. Please try again.';
    case 'chat':
      return 'Failed to send message. Please try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
