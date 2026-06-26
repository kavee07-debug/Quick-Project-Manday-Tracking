import type { ReactNode } from 'react';
import './Modal.scss';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, onClose, children }: Props) {
  return (
    <div className="modal__backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2 className="modal__title">{title}</h2>
          <button className="btn btn--sm" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}
