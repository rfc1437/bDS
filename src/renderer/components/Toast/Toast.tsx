import React from 'react';
import { Toaster, toast } from 'react-hot-toast';
import './Toast.css';

// Custom toast functions
export const showToast = {
  success: (message: string) => toast.success(message, {
    duration: 4000,
    position: 'bottom-right',
  }),
  
  error: (message: string) => toast.error(message, {
    duration: 6000,
    position: 'bottom-right',
  }),
  
  info: (message: string) => toast(message, {
    duration: 4000,
    position: 'bottom-right',
    icon: 'ℹ️',
  }),
  
  loading: (message: string) => toast.loading(message, {
    position: 'bottom-right',
  }),
  
  promise: <T,>(
    promise: Promise<T>,
    msgs: { loading: string; success: string; error: string }
  ) => toast.promise(promise, msgs, {
    position: 'bottom-right',
  }),
  
  dismiss: (toastId?: string) => {
    if (toastId) {
      toast.dismiss(toastId);
    } else {
      toast.dismiss();
    }
  },
};

// Toast container component
export const ToastContainer: React.FC = () => {
  return (
    <Toaster
      position="bottom-right"
      reverseOrder={false}
      gutter={8}
      containerClassName="toast-container"
      toastOptions={{
        // Default options for all toasts
        duration: 4000,
        style: {
          background: 'var(--vscode-notifications-background, #252526)',
          color: 'var(--vscode-notifications-foreground, #cccccc)',
          border: '1px solid var(--vscode-notifications-border, #3c3c3c)',
          borderRadius: '4px',
          padding: '12px 16px',
          fontSize: '13px',
          maxWidth: '400px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        },
        // Type-specific styling
        success: {
          iconTheme: {
            primary: 'var(--vscode-testing-iconPassed, #89d185)',
            secondary: 'var(--vscode-notifications-background, #252526)',
          },
        },
        error: {
          iconTheme: {
            primary: 'var(--vscode-testing-iconFailed, #f14c4c)',
            secondary: 'var(--vscode-notifications-background, #252526)',
          },
        },
      }}
    />
  );
};
