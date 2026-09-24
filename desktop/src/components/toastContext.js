import { createContext, useContext } from 'react';

// Spec I §5.2 Punkt 4 -- Zugang zur Hinweisleiste (ToastProvider in Toast.jsx):
// const toast = useToast(); toast.show({ text, action: { label, run }, ms });
export const ToastContext = createContext({ show: () => {}, dismiss: () => {} });

export function useToast() {
  return useContext(ToastContext);
}
