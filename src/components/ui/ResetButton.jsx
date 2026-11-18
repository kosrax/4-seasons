import React, { useEffect } from "react";

export function ResetButton({ isRotated, onReset }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (
        (e.key === 'r' || e.key === 'R') &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        onReset();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onReset]);

  if (!isRotated) return null;
  
  return (
    <button
    type="button"
    className="reset-view-button"
    onClick={onReset}
    aria-label="Reset 3D typography orientation (Shortcut: R)"
    >
      <span>Reset View</span>
    </button>
  );
}