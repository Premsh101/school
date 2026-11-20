import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiFailure, api } from './api';

/**
 * Signs out and goes back to the sign-in screen. Only the server can end the session (the
 * cookie is HttpOnly), so if the request does not get through the person stays where they are
 * and sees the error, instead of a screen that would reopen the app once the network is back.
 * "Already signed out" (401) counts as done.
 */
export function useSignOut(onFail?: (message: string) => void) {
  const client = useQueryClient();
  const leave = () => {
    client.clear();
    window.location.replace('/');
  };
  return useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSuccess: leave,
    onError: (e) => {
      if (e instanceof ApiFailure && e.status === 401) leave();
      else onFail?.(e.message);
    },
  });
}
