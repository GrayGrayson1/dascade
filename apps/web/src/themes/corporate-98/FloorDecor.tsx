/**
 * Corporate Desktop '98 floor decor: desktop shortcuts down the left edge and an IT department
 * sticky note on the right, as if the arcade floor were somebody's work PC. Purely decorative
 * (the slot is aria-hidden and pointer-events: none); shown only on roomy screens (skin.css).
 * Static — nothing animates.
 */
import type { ReactNode } from 'react';
import type { SkinRenderContext } from '../types.ts';

function Icon({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="c98-icon">
      <svg viewBox="0 0 32 32" width="32" height="32" shapeRendering="crispEdges" aria-hidden focusable="false">
        {children}
      </svg>
      <span className="c98-icon__label">{label}</span>
    </span>
  );
}

export function FloorDecor(_ctx: SkinRenderContext) {
  return (
    <div className="c98-desk">
      <div className="c98-desk__icons">
        <Icon label="Workstation">
          <rect x="3" y="4" width="26" height="18" fill="#d8d1bc" stroke="#000" />
          <rect x="6" y="7" width="20" height="12" fill="#1d4fae" />
          <rect x="7" y="8" width="8" height="2" fill="#8fb3f0" />
          <rect x="11" y="22" width="10" height="3" fill="#a39c86" stroke="#000" />
          <rect x="6" y="25" width="20" height="3" fill="#d8d1bc" stroke="#000" />
        </Icon>
        <Icon label="Shared Drive (S:)">
          <rect x="3" y="10" width="26" height="12" fill="#c4c4bf" stroke="#000" />
          <rect x="5" y="12" width="14" height="2" fill="#86868a" />
          <rect x="24" y="15" width="3" height="3" fill="#2fdc4a" />
          <rect x="15" y="22" width="2" height="5" fill="#000" />
          <rect x="6" y="27" width="20" height="2" fill="#000" />
        </Icon>
        <Icon label="Q3_FINAL_v7.TXT">
          <path d="M7 3h13l6 6v20H7z" fill="#fff" stroke="#000" />
          <path d="M20 3v6h6" fill="#c4c4bf" stroke="#000" />
          <rect x="10" y="13" width="13" height="1" fill="#000" />
          <rect x="10" y="16" width="13" height="1" fill="#000" />
          <rect x="10" y="19" width="9" height="1" fill="#000" />
          <rect x="10" y="22" width="12" height="1" fill="#000" />
        </Icon>
        <Icon label="Recycling">
          <path d="M8 9h16l-2 20H10z" fill="#d6d6d1" stroke="#000" />
          <rect x="6" y="6" width="20" height="3" fill="#c4c4bf" stroke="#000" />
          <rect x="13" y="3" width="6" height="3" fill="#c4c4bf" stroke="#000" />
          <rect x="12" y="12" width="1" height="14" fill="#86868a" />
          <rect x="16" y="12" width="1" height="14" fill="#86868a" />
          <rect x="20" y="12" width="1" height="14" fill="#86868a" />
        </Icon>
      </div>
      <div className="c98-note">
        <b>MEMO FROM IT</b>
        <span>Please do NOT install games on company computers.</span>
        <i>— Gary, ext. 4412</i>
      </div>
    </div>
  );
}
