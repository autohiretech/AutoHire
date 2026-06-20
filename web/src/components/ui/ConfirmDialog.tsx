import type { ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Body copy or rich content explaining what's about to happen. */
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Use the red button for irreversible / negative actions (decline, delete). */
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** A small yes/no confirmation built on the shared Modal — for guarded actions. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  busy = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} className="max-w-md">
      {body && <div className="text-sm text-ink-600">{body}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button variant={tone} onClick={onConfirm} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
