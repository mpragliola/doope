interface SidebarPaginationProps {
  currentPage: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}

export function SidebarPagination({ currentPage, totalPages, onPrev, onNext }: SidebarPaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 28,
        flexShrink: 0,
        background: '#161616',
        borderTop: '1px solid #2a2a2a',
        fontSize: 11,
        color: '#888',
      }}
    >
      <button
        onClick={onPrev}
        disabled={currentPage === 0}
        style={{
          background: 'none',
          border: 'none',
          color: currentPage === 0 ? '#444' : '#e2e2e2',
          cursor: currentPage === 0 ? 'default' : 'pointer',
          padding: '0 4px',
          fontSize: 13,
          lineHeight: 1,
        }}
      >
        ←
      </button>
      <span>
        Page {currentPage + 1} / {totalPages}
      </span>
      <button
        onClick={onNext}
        disabled={currentPage === totalPages - 1}
        style={{
          background: 'none',
          border: 'none',
          color: currentPage === totalPages - 1 ? '#444' : '#e2e2e2',
          cursor: currentPage === totalPages - 1 ? 'default' : 'pointer',
          padding: '0 4px',
          fontSize: 13,
          lineHeight: 1,
        }}
      >
        →
      </button>
    </div>
  );
}
