import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/**
 * Signs out and goes back to the sign-in screen. The screen changes even if the network
 * call fails (for example no internet), because the person asked to leave; the server
 * session then simply expires.
 */
export function useSignOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      client.clear();
      window.location.replace('/');
    },
  });
}
