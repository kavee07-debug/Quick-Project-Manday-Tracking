import type { BreakdownRow } from '../api/types';
import { Modal } from './Modal';
import { BreakdownTable } from './BreakdownTable';

// Popup listing the Job + Task + Type manday rows that make up a clicked pivot number.
export function BreakdownModal({ title, rows, onClose }: {
  title: string;
  rows: BreakdownRow[];
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose} className="modal--wide">
      <BreakdownTable rows={rows} />
    </Modal>
  );
}
