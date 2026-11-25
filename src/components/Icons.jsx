const S = ({ children, size = 16, ...p }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    {children}
  </svg>
);

export const IcMedia = (p) => (
  <S {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m10 9 5 3-5 3z" /></S>
);
export const IcGrid = (p) => (
  <S {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></S>
);
export const IcCaption = (p) => (
  <S {...p}><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M9 10.5a2.5 2.5 0 1 0 0 3M16.5 10.5a2.5 2.5 0 1 0 0 3" /></S>
);
export const IcText = (p) => (<S {...p}><path d="M5 6h14M12 6v13M9 19h6" /></S>);
export const IcAudio = (p) => (
  <S {...p}><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" /></S>
);
export const IcPlay = (p) => (<S {...p} fill="currentColor" stroke="none"><path d="M7 4.5v15l13-7.5z" /></S>);
export const IcPause = (p) => (<S {...p} fill="currentColor" stroke="none"><rect x="6" y="4.5" width="4" height="15" rx="1.2" /><rect x="14" y="4.5" width="4" height="15" rx="1.2" /></S>);
export const IcSplit = (p) => (<S {...p}><path d="M12 3v18M6 8l-3 4 3 4M18 8l3 4-3 4" /></S>);
export const IcTrash = (p) => (<S {...p}><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></S>);
export const IcCopy = (p) => (<S {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></S>);
export const IcUndo = (p) => (<S {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h9a6 6 0 0 1 0 12H8" /></S>);
export const IcRedo = (p) => (<S {...p}><path d="m15 14 5-5-5-5" /><path d="M20 9h-9a6 6 0 0 0 0 12h5" /></S>);
export const IcDownload = (p) => (<S {...p}><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" /></S>);
export const IcSpark = (p) => (<S {...p}><path d="m12 3 1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z" /><path d="M18.5 16.5 19 18l1.5.5-1.5.5-.5 1.5-.5-1.5L16.5 18l1.5-.5z" /></S>);
export const IcPlus = (p) => (<S {...p}><path d="M12 5v14M5 12h14" /></S>);
export const IcX = (p) => (<S {...p}><path d="m6 6 12 12M18 6 6 18" /></S>);
export const IcRipple = (p) => (<S {...p}><path d="M3 12h6M15 12h6" /><rect x="9" y="7" width="6" height="10" rx="1.5" /></S>);
export const IcKey = (p) => (<S {...p}><circle cx="8" cy="12" r="4" /><path d="M12 12h9M18 12v3" /></S>);
export const IcZoomIn = (p) => (<S {...p}><circle cx="11" cy="11" r="6.5" /><path d="M11 8.5v5M8.5 11h5M20 20l-4.6-4.6" /></S>);
export const IcZoomOut = (p) => (<S {...p}><circle cx="11" cy="11" r="6.5" /><path d="M8.5 11h5M20 20l-4.6-4.6" /></S>);
export const IcVolume = (p) => (<S {...p}><path d="M4 9.5h3L11 6v12l-4-3.5H4z" /><path d="M15 9.5a3.5 3.5 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10" /></S>);
export const IcMute = (p) => (<S {...p}><path d="M4 9.5h3L11 6v12l-4-3.5H4z" /><path d="m15 10 4 4M19 10l-4 4" /></S>);
