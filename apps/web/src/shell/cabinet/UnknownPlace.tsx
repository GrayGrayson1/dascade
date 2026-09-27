/** A light "nothing here" screen for bad /cabinet/:id and /play/:id links (keeps these routes free of the room screen). */
import { Link } from 'react-router';
import { PixelIcon } from '@dascade/ui';

export function UnknownPlace({ title, text }: { title: string; text: string }) {
  return (
    <main className="cp-missing center-screen" id="main">
      <div className="cp-missing__card">
        <PixelIcon name="help" size={28} />
        <h1>{title}</h1>
        <p>{text}</p>
        <Link className="dc-btn dc-btn--primary dc-btn--md" to="/">
          <PixelIcon name="arrow-left" size={16} /> Back to the arcade
        </Link>
      </div>
    </main>
  );
}
